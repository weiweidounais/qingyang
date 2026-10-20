import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createConnection } from "mysql2/promise";
import { LocalRuntime, projectRoot, users } from "../dev/runtime.js";
import { NutritionService } from "../nutrition.service.js";
import { RecognitionWorker } from "../recognition.worker.js";
import {
  RestaurantsService,
  type PoiPort,
} from "../../restaurants/restaurants.service.js";
import {
  CursorCodec,
  DomainError,
  foodInputs,
  recordedAt,
  businessDate,
  totals,
} from "../domain.js";
import type {
  MediaPort,
  PointsPort,
  OutboxPort,
  CommandContext,
} from "../../../../contracts/shared-types.js";

test("M03真实MySQL边界与持久化验证", async (t) => {
  const cfg = JSON.parse(
    await readFile(`${projectRoot}/.local/m03-db.json`, "utf8"),
  );
  const db = `qingyang_test_m03_${Date.now()}`;
  const admin = await createConnection({
    socketPath: cfg.socketPath,
    user: "root",
    password: cfg.password,
    multipleStatements: true,
  });
  await admin.query(
    `CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
  );
  await admin.changeUser({
    user: "root",
    password: cfg.password,
    database: db,
  });
  await admin.query(
    await readFile(
      `${projectRoot}/server/db/migrations/V001__baseline.sql`,
      "utf8",
    ),
  );
  const rt = new LocalRuntime({ ...cfg, database: db });
  t.after(async () => {
    await rt.pool.end();
    await admin.query(`DROP DATABASE ${db}`);
    await admin.end();
  });
  for (const [key, id] of Object.entries(users))
    await admin.query(
      "INSERT INTO users (id,phone_ciphertext,phone_lookup_hash,nickname) VALUES (?,?,?,?)",
      [
        id,
        "TEST_FIXTURE",
        createHash("sha256").update(key).digest("hex"),
        `test ${key}`,
      ],
    );
  const foodId = randomUUID();
  await admin.query(
    "INSERT INTO foods(id,name,calories_per_100g,carbs_per_100g,protein_per_100g,fat_per_100g,source) VALUES (?,'TEST food',130,28.2,2.7,0.3,'TEST_FIXTURE')",
    [foodId],
  );
  const cursors = new CursorCodec("test-secret");
  let awardCalls = 0;
  const points: PointsPort = {
    ensureAccountInTransaction: async () => ({
      balance: 0,
      lifetimeEarned: 0,
      lifetimeSpent: 0,
      version: 0,
    }),
    awardInTransaction: async () => {
      awardCalls++;
      return {
        awards: [],
        account: {
          balance: 0,
          lifetimeEarned: 0,
          lifetimeSpent: 0,
          version: 0,
        },
      };
    },
  };
  const outbox: OutboxPort = {
    enqueueInTransaction: async () => ({ id: randomUUID() }),
  };
  const media: MediaPort = {
    assertReady: async (tx, input) => {
      const [row] = await tx.query<Record<string, any>>(
        "SELECT * FROM media_assets WHERE id=? AND user_id=? AND purpose='meal_photo' AND status='ready'",
        [input.assetId, input.actorUserId],
      );
      if (!row) throw new DomainError("NOT_FOUND", "test", 404);
      return {
        assetId: row.id,
        userId: row.user_id,
        purpose: "meal_photo",
        contentType: "image/png",
        sizeBytes: 10,
      };
    },
    createReadUrl: async (input) => ({
      assetId: input.assetId,
      readUrl: "https://example.invalid/fixture",
      readUrlExpiresAt: new Date(Date.now() + 300000).toISOString(),
    }),
  };
  const service = new NutritionService({ points, outbox, media, cursors });
  const manual = () => ({
    mealType: "lunch",
    source: "manual",
    items: [
      { nutritionSource: "catalog", foodId, grams: 150 },
      {
        nutritionSource: "user",
        name: "TEST side",
        grams: 100,
        caloriesKcal: 80,
        carbsG: null,
        proteinG: null,
        fatG: null,
      },
    ],
  });
  const create = (
    body: unknown = manual(),
    key = randomUUID(),
    userId = users.a,
  ) =>
    rt.command(userId, "POST", "/me/meals", key, body, async (tx, ctx) => ({
      status: 201,
      data: await service.create(tx, ctx, body),
    }));
  let mealId = "";
  await t.test(
    "多食物保存、服务端计算、未知营养、查询端口、重连仍存在",
    async () => {
      const result = await create();
      const meal = (result.data as any).meal;
      mealId = meal.id;
      assert.equal(meal.totals.caloriesKcal, 275);
      assert.equal(meal.totals.carbsG, null);
      assert.equal(meal.items[0].grams, 150);
      assert.equal(meal.items[0].nutritionSource, "catalog");
      const queried = await rt.readSnapshot((tx) =>
        service.get(tx, users.a, meal.id),
      );
      assert.deepEqual(queried, meal);
      const days = await rt.readSnapshot((tx) =>
        service.days(tx, users.a, meal.businessDate, meal.businessDate),
      );
      assert.equal(days[0].carbs.knownG, 42.3);
      assert.equal(days[0].carbs.complete, false);
      const latest = await rt.readSnapshot((tx) =>
        service.latestMeal(tx, users.a, meal.businessDate),
      );
      assert.equal(latest!.id, meal.id);
      const other = new LocalRuntime({ ...cfg, database: db });
      try {
        assert.equal(
          (await other.readSnapshot((tx) => service.get(tx, users.a, meal.id)))
            .id,
          meal.id,
        );
      } finally {
        await other.pool.end();
      }
    },
  );
  await t.test(
    "重复请求只形成一餐，同key改正文409，并发租约不重复执行",
    async () => {
      const key = randomUUID(),
        body = manual(),
        before = awardCalls;
      const r1 = await create(body, key),
        r2 = await create(body, key);
      assert.deepEqual(r1, r2);
      assert.equal(awardCalls, before + 1);
      await assert.rejects(
        create({ ...body, mealType: "dinner" }, key),
        (e: any) => e.code === "IDEMPOTENCY_CONFLICT",
      );
      const concurrentKey = randomUUID();
      const attempts = await Promise.allSettled([
        create(body, concurrentKey),
        create(body, concurrentKey),
      ]);
      assert.ok(attempts.some((x) => x.status === "fulfilled"));
      const [rows] = await admin.query(
        "SELECT COUNT(*) n FROM idempotency_requests WHERE idempotency_key=? AND status='completed'",
        [concurrentKey],
      );
      assert.equal((rows as any[])[0].n, 1);
    },
  );
  await t.test("跨用户不可读取、编辑、删除", async () => {
    await assert.rejects(
      rt.readSnapshot((tx) => service.get(tx, users.b, mealId)),
      (e: any) => e.status === 404,
    );
    await assert.rejects(
      rt.runForUser(users.b, (tx, ctx) =>
        service.update(tx, ctx, mealId, { version: 1, mealType: "snack" }),
      ),
      (e: any) => e.status === 404,
    );
    await assert.rejects(
      rt.runForUser(users.b, (tx, ctx) => service.remove(tx, ctx, mealId)),
      (e: any) => e.status === 404,
    );
  });
  await t.test(
    "目录更新不回改历史快照；版本冲突；移动日期与软删除同步统计",
    async () => {
      await admin.query("UPDATE foods SET calories_per_100g=200 WHERE id=?", [
        foodId,
      ]);
      assert.equal(
        (await rt.readSnapshot((tx) => service.get(tx, users.a, mealId)))
          .items[0].caloriesKcal,
        195,
      );
      const yesterday = new Date(Date.now() - 86400000).toISOString();
      const updated = await rt.runForUser(users.a, (tx, ctx) =>
        service.update(tx, ctx, mealId, {
          version: 1,
          recordedAt: yesterday,
          mealType: "dinner",
        }),
      );
      assert.equal(updated.businessDate, businessDate(yesterday));
      assert.equal(updated.version, 2);
      await assert.rejects(
        rt.runForUser(users.a, (tx, ctx) =>
          service.update(tx, ctx, mealId, { version: 1, mealType: "snack" }),
        ),
        (e: any) => e.code === "VERSION_CONFLICT",
      );
      await rt.runForUser(users.a, (tx, ctx) =>
        service.remove(tx, ctx, mealId),
      );
      assert.deepEqual(
        await rt.readSnapshot((tx) =>
          service.days(tx, users.a, updated.businessDate, updated.businessDate),
        ),
        [],
      );
    },
  );
  await t.test(
    "输入边界、来源伪造、人工置信度与客户端totals被拒绝",
    async () => {
      for (const items of [
        [],
        Array.from({ length: 31 }, () => manual().items[0]),
        [{ ...manual().items[0], grams: 0 }],
        [{ ...manual().items[0], confidence: 1 }],
        [{ ...manual().items[1], status: "succeeded" }],
        [{ nutritionSource: "model", candidateIndex: 0 }],
      ])
        await assert.rejects(create({ ...manual(), items }));
      await assert.rejects(
        create({ ...manual(), totals: { caloriesKcal: 1 } }),
        (e: any) => e.code === "UNKNOWN_FIELD",
      );
      assert.throws(() =>
        foodInputs([{ nutritionSource: "model", candidateIndex: 0 }], false),
      );
      assert.throws(() =>
        recordedAt("2026-10-20T12:00:00", "2026-10-20T08:00:00.000Z"),
      );
      assert.equal(businessDate("2026-10-20T15:59:59Z"), "2026-10-20");
      assert.equal(businessDate("2026-10-20T16:00:00Z"), "2026-10-21");
      assert.throws(() =>
        recordedAt("2026-09-01T00:00:00Z", "2026-10-20T00:00:00Z"),
      );
    },
  );
  await t.test("发奖端口失败时整个记餐事务回滚", async () => {
    const broken = new NutritionService({
      points: {
        ...points,
        awardInTransaction: async () => {
          throw Error("M05 unavailable");
        },
      },
      outbox,
      media,
      cursors,
    });
    const [before] = await admin.query("SELECT COUNT(*) n FROM meals");
    await assert.rejects(
      rt.runForUser(users.a, (tx, ctx) => broken.create(tx, ctx, manual())),
    );
    const [after] = await admin.query("SELECT COUNT(*) n FROM meals");
    assert.equal((before as any[])[0].n, (after as any[])[0].n);
  });
  async function asset(owner = users.a, status = "ready") {
    const id = randomUUID();
    await admin.query(
      "INSERT INTO media_assets(id,user_id,purpose,bucket,object_key,safe_object_key,content_type,size_bytes,checksum_sha256,status) VALUES (?,?,'meal_photo','test',?,?,'image/png',10,?,?)",
      [id, owner, id, `${id}.safe`, "0".repeat(64), status],
    );
    return id;
  }
  async function queued(assetId: string, owner = users.a) {
    const id = randomUUID();
    await admin.query(
      "INSERT INTO recognition_jobs(id,user_id,asset_id) VALUES (?,?,?)",
      [id, owner, assetId],
    );
    return id;
  }
  const result = {
    items: [
      {
        candidateIndex: 0,
        foodId: null,
        name: "TEST MODEL",
        grams: 100,
        caloriesKcal: 120,
        carbsG: null,
        proteinG: null,
        fatG: null,
        nutritionSource: "model",
        confidence: 0.7,
      },
    ],
  };
  await t.test(
    "识别只产候选；重复派发只调用一次；同任务重复确认与软删不可重用",
    async () => {
      const aid = await asset(),
        jid = await queued(aid);
      let calls = 0;
      const worker = new RecognitionWorker(rt, media, service, {
        provider: "fixture",
        model: "fixture",
        recognize: async () => {
          calls++;
          return result;
        },
      });
      await Promise.all([worker.run(jid), worker.run(jid)]);
      assert.equal(calls, 1);
      const job = await rt.readSnapshot((tx) => service.job(tx, users.a, jid));
      assert.equal(job.status, "succeeded");
      const [before] = await admin.query(
        "SELECT COUNT(*) n FROM meals WHERE recognition_job_id=?",
        [jid],
      );
      assert.equal((before as any[])[0].n, 0);
      const body = {
        mealType: "lunch",
        source: "photo",
        photoAssetId: aid,
        recognitionJobId: jid,
        items: [{ nutritionSource: "model", candidateIndex: 0 }],
      };
      const first = await create(body),
        second = await create(body);
      assert.equal((first.data as any).meal.id, (second.data as any).meal.id);
      await rt.runForUser(users.a, (tx, ctx) =>
        service.remove(tx, ctx, (first.data as any).meal.id),
      );
      await assert.rejects(
        create(body),
        (e: any) => e.code === "RECOGNITION_ALREADY_USED",
      );
      await assert.rejects(
        create({
          ...body,
          items: [{ nutritionSource: "model", candidateIndex: 3 }],
        }),
      );
      await assert.rejects(
        create(body, randomUUID(), users.b),
        (e: any) => e.status === 404,
      );
    },
  );
  await t.test(
    "本人非ready照片、他人照片无法创建识别；取消后迟到结果不能覆盖",
    async () => {
      const pending = await asset(users.a, "pending");
      await assert.rejects(
        rt.runForUser(users.a, (tx, ctx) =>
          service.createJob(tx, ctx, { assetId: pending }),
        ),
      );
      const other = await asset(users.b);
      await assert.rejects(
        rt.runForUser(users.a, (tx, ctx) =>
          service.createJob(tx, ctx, { assetId: other }),
        ),
      );
      const aid = await asset(),
        jid = await queued(aid);
      let resolve!: (v: unknown) => void;
      let started!: () => void;
      const start = new Promise<void>((r) => {
        started = r;
      });
      const delayed = new Promise((r) => {
        resolve = r;
      });
      const worker = new RecognitionWorker(rt, media, service, {
        provider: "fixture",
        model: "fixture",
        recognize: async () => {
          started();
          return delayed;
        },
      });
      const running = worker.run(jid);
      await start;
      await rt.runForUser(users.a, (tx, ctx) =>
        service.cancelJob(tx, ctx, jid),
      );
      resolve(result);
      await running;
      assert.equal(
        (await rt.readSnapshot((tx) => service.job(tx, users.a, jid))).status,
        "canceled",
      );
    },
  );
  await t.test("未识别到食物时返回明确提示且不创建餐食", async () => {
    const jid = await queued(await asset());
    const worker = new RecognitionWorker(rt, media, service, {
      provider: "fixture", model: "fixture", recognize: async () => ({ items: [] }),
    });
    await worker.run(jid);
    const job = await rt.readSnapshot((tx) => service.job(tx, users.a, jid));
    assert.equal(job.status, "failed");
    assert.equal(job.error?.code, "NO_FOOD_DETECTED");
    assert.match(job.error!.message, /未识别到可确认的食物/);
    assert.match(job.error!.message, /饮品/);
    const [rows] = await admin.query("SELECT COUNT(*) n FROM meals WHERE recognition_job_id=?", [jid]);
    assert.equal((rows as any[])[0].n, 0);
  });
  await t.test("无效模型输出失败；过期租约被回收且不重发收费请求", async () => {
    const jid = await queued(await asset());
    let calls = 0;
    const worker = new RecognitionWorker(rt, media, service, {
      provider: "fixture",
      model: "fixture",
      recognize: async () => {
        calls++;
        return { items: "invalid" };
      },
    });
    await worker.run(jid);
    assert.equal(
      (await rt.readSnapshot((tx) => service.job(tx, users.a, jid))).status,
      "failed",
    );
    await worker.run(jid);
    assert.equal(calls, 1);
    const expired = await queued(await asset());
    await admin.query(
      "UPDATE recognition_jobs SET status='running',started_at=UTC_TIMESTAMP(3),run_token=?,lease_until=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND),attempts=1 WHERE id=?",
      [randomUUID(), expired],
    );
    assert.equal(await worker.recoverExpired(), 1);
    assert.equal(
      (await rt.readSnapshot((tx) => service.job(tx, users.a, expired))).error
        ?.code,
      "RECOGNITION_LEASE_EXPIRED",
    );
  });
  await t.test(
    "门店收藏幂等、隔离、下架可取消、评分与营养未知不补值",
    async () => {
      const id = randomUUID();
      await admin.query(
        "INSERT INTO restaurants(id,provider,provider_place_id,name,address,latitude,longitude,tags,source_updated_at) VALUES (?,'TEST_FIXTURE',?,'TEST PLACE','TEST ADDRESS',31,121,'[]',UTC_TIMESTAMP(3))",
        [id, id],
      );
      const service = new RestaurantsService(cursors);
      await rt.runForUser(users.a, (tx, ctx) =>
        service.favorite(tx, ctx, id, true),
      );
      await rt.runForUser(users.a, (tx, ctx) =>
        service.favorite(tx, ctx, id, true),
      );
      const a = await rt.readSnapshot((tx) =>
          service.favorites(tx, users.a, {}),
        ),
        b = await rt.readSnapshot((tx) => service.favorites(tx, users.b, {}));
      assert.equal(a.items.length, 1);
      assert.equal(b.items.length, 0);
      assert.equal(a.items[0].rating, null);
      assert.equal(a.items[0].estimatedCaloriesKcal, null);
      assert.equal(a.items[0].distanceMeters, null);
      await admin.query(
        "UPDATE restaurants SET status='unavailable' WHERE id=?",
        [id],
      );
      assert.equal(
        (await rt.readSnapshot((tx) => service.favorites(tx, users.a, {})))
          .items[0].status,
        "unavailable",
      );
      await rt.runForUser(users.a, (tx, ctx) =>
        service.favorite(tx, ctx, id, false),
      );
      await rt.runForUser(users.a, (tx, ctx) =>
        service.favorite(tx, ctx, id, false),
      );
      await assert.rejects(
        rt.readSnapshot((tx) =>
          service.nearby(tx, users.a, {
            latitude: "31",
            longitude: "121",
            coordinateSystem: "wgs84",
          }),
        ),
        (e: any) => e.code === "POI_NOT_CONFIGURED",
      );
    },
  );
  await t.test("实时门店查询不写缓存或收藏，临时编号不可收藏", async () => {
    const provider: PoiPort = {
      provider: "TEST_LIVE", cacheTtlSeconds: 0,
      detail: async () => null,
      nearby: async () => ({ nextCursor: null, items: [{
        provider: "TEST_LIVE", providerPlaceId: "fixture-place", name: "TEST LIVE", address: "TEST ADDRESS",
        latitude: 31, longitude: 121, coordinateSystem: "wgs84", distanceMeters: 0,
        rating: null, ratingScaleMax: null, priceCents: null, currency: "CNY", tags: [], coverUrl: null,
        nutritionVerified: false, estimatedCaloriesKcal: null, status: "available", sourceUpdatedAt: new Date().toISOString(),
      }] }),
    };
    const service = new RestaurantsService(cursors, provider);
    const result = await service.search(users.a, { latitude: "31", longitude: "121", coordinateSystem: "wgs84" },
      (run) => rt.readSnapshot(run), async () => { throw Error("不允许实时数据开启写事务"); });
    assert.equal(result.items.length, 1); assert.equal(result.items[0].isFavorited, false);
    await assert.rejects(rt.runForUser(users.a, (tx, ctx) => service.favorite(tx, ctx, result.items[0].id, true)), (e: any) => e.code === "NOT_FOUND");
    const [rows] = await admin.query("SELECT COUNT(*) n FROM restaurants WHERE provider='TEST_LIVE'");
    assert.equal((rows as any[])[0].n, 0);
  });
  await t.test("游标绑定用户与筛选；未知营养保留null", async () => {
    const c = cursors.encode(
      { id: randomUUID() },
      { center: [1, 2], userId: users.a },
    );
    assert.throws(() => cursors.decode(c, { center: [3, 4], userId: users.a }));
    assert.throws(() => cursors.decode(c, { center: [1, 2], userId: users.b }));
    assert.equal(
      totals([{ caloriesKcal: 1, carbsG: null, proteinG: 1, fatG: 0 }]).carbsG,
      null,
    );
  });
});
