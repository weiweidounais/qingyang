import { randomUUID } from "node:crypto";
import type {
  SqlTx,
  CommandContext,
  PointsPort,
  OutboxPort,
  MediaPort,
  FoodItemDto,
  FoodItemDraft,
  FoodItemInput,
  MealDto,
  RecognitionJobDto,
  NutritionQueryPort,
  NutritionDay,
} from "../../../contracts/shared-types.js";
import {
  CursorCodec,
  date,
  decimal,
  fail,
  foodInputs,
  keys,
  mealType,
  object,
  recordedAt,
  round,
  text,
  totals,
  uuid,
  businessDate,
} from "./domain.js";

type Row = Record<string, any>;
const iso = (x: string | Date) => new Date(x).toISOString();
const nullable = (x: unknown) => (x == null ? null : Number(x));
export interface NutritionDependencies {
  points: PointsPort;
  outbox: OutboxPort;
  media: MediaPort;
  cursors: CursorCodec;
}

/** 所有写入复用调用方的SqlTx。生产装配时注入M01/M05端口，不从本模块创建连接。 */
export class NutritionService implements NutritionQueryPort {
  constructor(private ports: NutritionDependencies) {}

  async foods(tx: SqlTx, query: Record<string, string>) {
    keys(query, ["keyword", "limit", "cursor"]);
    const keyword =
      query.keyword === undefined ? "" : text(query.keyword, 50, "关键词");
    const limit = this.limit(query.limit);
    const cursor = this.ports.cursors.decode(query.cursor, {
      type: "foods",
      keyword,
    });
    const rows = await tx.query<Row>(
      `SELECT * FROM foods WHERE status='published' AND name LIKE ?${cursor ? " AND (name > ? OR (name = ? AND id > ?))" : ""} ORDER BY name,id LIMIT ?`,
      [
        `%${keyword.replace(/[\\%_]/g, "\\$&")}%`,
        ...(cursor
          ? [String(cursor.name), String(cursor.name), uuid(cursor.id)]
          : []),
        limit + 1,
      ],
    );
    const more = rows.length > limit;
    const list = rows.slice(0, limit);
    const last = list.at(-1);
    return {
      items: list.map((x) => ({
        id: x.id,
        name: x.name,
        unit: "100g",
        caloriesKcal: Number(x.calories_per_100g),
        carbsG: nullable(x.carbs_per_100g),
        proteinG: nullable(x.protein_per_100g),
        fatG: nullable(x.fat_per_100g),
      })),
      nextCursor:
        more && last
          ? this.ports.cursors.encode(
              { id: last.id, name: last.name },
              { type: "foods", keyword },
            )
          : null,
    };
  }
  limit(value?: string, max = 100) {
    const n = value === undefined ? 20 : Number(value);
    if (!Number.isInteger(n) || n < 1 || n > max)
      fail("INVALID_LIMIT", `每页数量需在1—${max}之间`);
    return n;
  }
  async list(tx: SqlTx, userId: string, q: Record<string, string>) {
    keys(q, ["date", "mealType", "limit", "cursor"]);
    const d = date(q.date);
    const type = q.mealType ? mealType(q.mealType) : null;
    const limit = this.limit(q.limit);
    const filter = { type: "meals", userId, date: d, mealType: type };
    const cursor = this.ports.cursors.decode(q.cursor, filter);
    const rows = await tx.query<Row>(
      `SELECT * FROM meals WHERE user_id=? AND business_date=? AND deleted_at IS NULL${type ? " AND meal_type=?" : ""}${cursor ? " AND (recorded_at < ? OR (recorded_at = ? AND id < ?))" : ""} ORDER BY recorded_at DESC,id DESC LIMIT ?`,
      [
        userId,
        d,
        ...(type ? [type] : []),
        ...(cursor
          ? [
              new Date(String(cursor.at)),
              new Date(String(cursor.at)),
              uuid(cursor.id),
            ]
          : []),
        limit + 1,
      ],
    );
    const list = rows.slice(0, limit);
    const last = list.at(-1);
    return {
      items: await Promise.all(list.map((r) => this.mapMeal(tx, r))),
      nextCursor:
        rows.length > limit && last
          ? this.ports.cursors.encode(
              { id: last.id, at: iso(last.recorded_at) },
              filter,
            )
          : null,
    };
  }
  async get(tx: SqlTx, userId: string, id: string): Promise<MealDto> {
    const [r] = await tx.query<Row>(
      "SELECT * FROM meals WHERE id=? AND user_id=? AND deleted_at IS NULL",
      [uuid(id), userId],
    );
    if (!r) fail("NOT_FOUND", "这条饮食记录不存在或已删除", 404);
    return this.mapMeal(tx, r);
  }
  private async mapMeal(tx: SqlTx, r: Row): Promise<MealDto> {
    const items = (
      await tx.query<Row>(
        "SELECT * FROM meal_items WHERE meal_id=? ORDER BY sort_order",
        [r.id],
      )
    ).map(
      (x) =>
        ({
          id: x.id,
          foodId: x.food_id,
          name: x.name,
          grams: Number(x.grams),
          caloriesKcal: Number(x.calories_kcal),
          carbsG: nullable(x.carbs_g),
          proteinG: nullable(x.protein_g),
          fatG: nullable(x.fat_g),
          nutritionSource: x.nutrition_source,
          confidence: nullable(x.confidence),
        }) as FoodItemDto,
    );
    return {
      id: r.id,
      mealType: r.meal_type,
      recordedAt: iso(r.recorded_at),
      businessDate: r.business_date,
      source: r.source,
      photoAssetId: r.photo_asset_id,
      photoUrl: null,
      items,
      totals: totals(items),
      version: r.version,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
    };
  }
  /** 私有URL只能在事务之外授权签发，不参与饮食事实与统计。 */
  async withPhoto(meal: MealDto, userId: string): Promise<MealDto> {
    if (!meal.photoAssetId) return meal;
    const { readUrl } = await this.ports.media.createReadUrl({
      assetId: meal.photoAssetId,
      purpose: "meal_photo",
      actorUserId: userId,
      access: "owner",
      expiresInSeconds: 300,
    });
    return { ...meal, photoUrl: readUrl };
  }
  async create(tx: SqlTx, ctx: CommandContext, body: unknown) {
    const b = object(body);
    keys(b, [
      "mealType",
      "recordedAt",
      "source",
      "photoAssetId",
      "recognitionJobId",
      "items",
    ]);
    const type = mealType(b.mealType);
    const at = recordedAt(b.recordedAt, ctx.operationNow);
    const inputs = foodInputs(b.items, true);
    if (b.source !== "manual" && b.source !== "photo")
      fail("INVALID_SOURCE", "请选择手动记录或照片记录");
    const assetId = b.photoAssetId === undefined ? null : uuid(b.photoAssetId);
    const jobId =
      b.recognitionJobId === undefined ? null : uuid(b.recognitionJobId);
    if (b.source === "photo" && !assetId)
      fail("PHOTO_REQUIRED", "照片记录需要上传后的照片");
    if (jobId && (b.source !== "photo" || !assetId))
      fail("INVALID_RECOGNITION", "识别任务必须对应本餐照片");
    if (assetId)
      await this.ports.media.assertReady(tx, {
        assetId,
        purpose: "meal_photo",
        actorUserId: ctx.userId,
        access: "owner",
      });
    let candidates: FoodItemDraft[] | null = null;
    if (jobId) {
      const [job] = await tx.query<Row>(
        "SELECT * FROM recognition_jobs WHERE id=? AND user_id=? AND asset_id=? FOR UPDATE",
        [jobId, ctx.userId, assetId],
      );
      if (!job) fail("NOT_FOUND", "识别任务与照片不匹配", 404);
      const [used] = await tx.query<Row>(
        "SELECT id,deleted_at FROM meals WHERE recognition_job_id=?",
        [jobId],
      );
      if (used) {
        if (used.deleted_at)
          fail(
            "RECOGNITION_ALREADY_USED",
            "这次识别已被使用，不能重新确认",
            409,
          );
        return { meal: await this.get(tx, ctx.userId, used.id), awards: [] };
      }
      if (job.status !== "succeeded")
        fail("RECOGNITION_NOT_SUCCEEDED", "只有成功的识别结果可以确认", 409);
      candidates = this.validateCandidates(
        typeof job.result === "string" ? JSON.parse(job.result) : job.result,
      );
    }
    const items = await this.materialize(tx, inputs, candidates);
    const id = randomUUID();
    await tx.execute(
      "INSERT INTO meals (id,user_id,meal_type,recorded_at,business_date,source,photo_asset_id,recognition_job_id) VALUES (?,?,?,?,?,?,?,?)",
      [
        id,
        ctx.userId,
        type,
        new Date(at),
        businessDate(at),
        b.source,
        assetId,
        jobId,
      ],
    );
    await this.insertItems(tx, id, items);
    const { awards } = await this.ports.points.awardInTransaction(tx, ctx, {
      type: "meal_confirmed",
      sourceId: id,
    });
    return { meal: await this.get(tx, ctx.userId, id), awards };
  }
  async update(tx: SqlTx, ctx: CommandContext, id: string, body: unknown) {
    const b = object(body);
    keys(b, ["version", "mealType", "recordedAt", "items"]);
    if (!Number.isInteger(b.version) || (b.version as number) < 1)
      fail("VERSION_REQUIRED", "修改记录需要当前版本号");
    if (
      b.mealType === undefined &&
      b.recordedAt === undefined &&
      b.items === undefined
    )
      fail("EMPTY_UPDATE", "没有需要保存的修改");
    const [r] = await tx.query<Row>(
      "SELECT * FROM meals WHERE id=? AND user_id=? AND deleted_at IS NULL FOR UPDATE",
      [uuid(id), ctx.userId],
    );
    if (!r) fail("NOT_FOUND", "这条饮食记录不存在或已删除", 404);
    if (r.version !== b.version)
      fail("VERSION_CONFLICT", "记录已被更新，请重新打开后编辑", 409);
    const type = b.mealType === undefined ? r.meal_type : mealType(b.mealType);
    const at =
      b.recordedAt === undefined
        ? iso(r.recorded_at)
        : recordedAt(b.recordedAt, ctx.operationNow);
    const items =
      b.items === undefined
        ? null
        : await this.materialize(tx, foodInputs(b.items, false), null);
    const result = await tx.execute(
      "UPDATE meals SET meal_type=?,recorded_at=?,business_date=?,version=version+1 WHERE id=? AND user_id=? AND version=? AND deleted_at IS NULL",
      [
        type,
        new Date(at),
        businessDate(at),
        id,
        ctx.userId,
        b.version as number,
      ],
    );
    if (!result.affectedRows)
      fail("VERSION_CONFLICT", "记录已被更新，请刷新后再试", 409);
    if (items) {
      await tx.execute("DELETE FROM meal_items WHERE meal_id=?", [id]);
      await this.insertItems(tx, id, items);
    }
    return this.get(tx, ctx.userId, id);
  }
  async remove(tx: SqlTx, ctx: CommandContext, id: string) {
    const [row] = await tx.query<Row>(
      "SELECT id,deleted_at FROM meals WHERE id=? AND user_id=? FOR UPDATE",
      [uuid(id), ctx.userId],
    );
    if (!row) fail("NOT_FOUND", "记录不存在", 404);
    if (!row.deleted_at)
      await tx.execute(
        "UPDATE meals SET deleted_at=?,version=version+1 WHERE id=? AND user_id=?",
        [new Date(ctx.operationNow), id, ctx.userId],
      );
    return null;
  }
  private async materialize(
    tx: SqlTx,
    inputs: FoodItemInput[],
    candidates: FoodItemDraft[] | null,
  ): Promise<Omit<FoodItemDto, "id">[]> {
    const used = new Set<number>();
    const items: Omit<FoodItemDto, "id">[] = [];
    for (const x of inputs) {
      if (x.nutritionSource === "catalog") {
        const [f] = await tx.query<Row>(
          "SELECT * FROM foods WHERE id=? AND status='published'",
          [x.foodId],
        );
        if (!f) fail("FOOD_UNAVAILABLE", "所选食物已不可用，请重新选择");
        const scale = (v: unknown) =>
          v == null ? null : round((Number(v) * x.grams) / 100);
        items.push({
          foodId: f.id,
          name: f.name,
          grams: x.grams,
          caloriesKcal: scale(f.calories_per_100g)!,
          carbsG: scale(f.carbs_per_100g),
          proteinG: scale(f.protein_per_100g),
          fatG: scale(f.fat_per_100g),
          nutritionSource: "catalog",
          confidence: null,
        });
      } else if (x.nutritionSource === "model") {
        const c = candidates?.[x.candidateIndex];
        if (!c || used.has(x.candidateIndex))
          fail("INVALID_CANDIDATE", "识别候选无效或重复");
        used.add(x.candidateIndex);
        const { candidateIndex: _, ...candidate } = c;
        items.push(candidate);
      } else {
        if (x.foodId) {
          const [f] = await tx.query<Row>("SELECT id FROM foods WHERE id=?", [
            x.foodId,
          ]);
          if (!f) fail("FOOD_UNAVAILABLE", "食物编号不存在");
        }
        items.push({ ...x, foodId: x.foodId ?? null, confidence: null });
      }
    }
    for (const item of items)
      foodInputs(
        [
          {
            nutritionSource: "user",
            foodId: item.foodId,
            name: item.name,
            grams: item.grams,
            caloriesKcal: item.caloriesKcal,
            carbsG: item.carbsG,
            proteinG: item.proteinG,
            fatG: item.fatG,
          },
        ],
        false,
      );
    return items;
  }
  private async insertItems(
    tx: SqlTx,
    mealId: string,
    items: Omit<FoodItemDto, "id">[],
  ) {
    for (const [i, x] of items.entries())
      await tx.execute(
        "INSERT INTO meal_items (id,meal_id,food_id,name,grams,calories_kcal,carbs_g,protein_g,fat_g,nutrition_source,confidence,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          randomUUID(),
          mealId,
          x.foodId,
          x.name,
          x.grams,
          x.caloriesKcal,
          x.carbsG,
          x.proteinG,
          x.fatG,
          x.nutritionSource,
          x.confidence,
          i,
        ],
      );
  }
  async days(
    tx: SqlTx,
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<NutritionDay[]> {
    date(startDate);
    date(endDate);
    const rows = await tx.query<Row>(
      "SELECT m.business_date, SUM(i.calories_kcal) kcal,SUM(i.carbs_g) carbs,SUM(i.protein_g) protein,SUM(i.fat_g) fat,COUNT(*) n,COUNT(i.carbs_g) nc,COUNT(i.protein_g) np,COUNT(i.fat_g) nf FROM meals m JOIN meal_items i ON i.meal_id=m.id WHERE m.user_id=? AND m.deleted_at IS NULL AND m.business_date BETWEEN ? AND ? GROUP BY m.business_date ORDER BY m.business_date",
      [userId, startDate, endDate],
    );
    return rows.map((r) => ({
      date: r.business_date,
      hasMealRecord: true,
      intakeKcal: Number(r.kcal),
      carbs: { knownG: Number(r.carbs ?? 0), complete: r.n === r.nc },
      protein: { knownG: Number(r.protein ?? 0), complete: r.n === r.np },
      fat: { knownG: Number(r.fat ?? 0), complete: r.n === r.nf },
    }));
  }
  async latestMeal(tx: SqlTx, userId: string, d: string) {
    return (
      (await this.list(tx, userId, { date: d, limit: "1" })).items[0] ?? null
    );
  }

  async createJob(tx: SqlTx, ctx: CommandContext, body: unknown) {
    const b = object(body);
    keys(b, ["assetId", "mealType"]);
    const assetId = uuid(b.assetId);
    if (b.mealType !== undefined) mealType(b.mealType);
    await this.ports.media.assertReady(tx, {
      assetId,
      purpose: "meal_photo",
      actorUserId: ctx.userId,
      access: "owner",
    });
    const id = randomUUID();
    await tx.execute(
      "INSERT INTO recognition_jobs (id,user_id,asset_id,meal_type_hint) VALUES (?,?,?,?)",
      [id, ctx.userId, assetId, (b.mealType as string) ?? null],
    );
    await this.ports.outbox.enqueueInTransaction(tx, {
      eventType: "nutrition.recognition.requested.v1",
      aggregateType: "recognition_job",
      aggregateId: id,
      eventKey: `nutrition.recognition.requested.v1:${id}`,
      schemaVersion: 1,
      payload: { jobId: id, userId: ctx.userId, assetId },
    });
    return { id, status: "queued", pollAfterMs: 1500 };
  }
  async job(tx: SqlTx, userId: string, id: string): Promise<RecognitionJobDto> {
    const [r] = await tx.query<Row>(
      "SELECT * FROM recognition_jobs WHERE id=? AND user_id=?",
      [uuid(id), userId],
    );
    if (!r) fail("NOT_FOUND", "识别任务不存在", 404);
    return {
      id: r.id,
      status: r.status,
      items:
        r.status === "succeeded"
          ? this.validateCandidates(
              typeof r.result === "string" ? JSON.parse(r.result) : r.result,
            )
          : [],
      error:
        r.status === "failed"
          ? { code: r.error_code, message: r.error_code === "NO_FOOD_DETECTED"
            ? "未识别到可确认的食物或饮品。拍咖啡等饮品时，请让液面或透明杯内的内容入镜；不透明杯中看不清的饮品，请手动补充名称、份量和营养信息。"
            : "识别未完成，可重新拍照或手动记餐" }
          : null,
      createdAt: iso(r.created_at),
      completedAt: r.completed_at ? iso(r.completed_at) : null,
    };
  }
  async cancelJob(tx: SqlTx, ctx: CommandContext, id: string) {
    uuid(id);
    await tx.execute(
      "UPDATE recognition_jobs SET status='canceled',completed_at=?,lease_until=NULL WHERE id=? AND user_id=? AND status IN ('queued','running')",
      [new Date(ctx.operationNow), id, ctx.userId],
    );
    const job = await this.job(tx, ctx.userId, id);
    return { id: job.id, status: job.status };
  }
  validateCandidates(result: unknown): FoodItemDraft[] {
    const r = object(result);
    keys(r, ["items"]);
    if (Array.isArray(r.items) && r.items.length === 0)
      fail("NO_FOOD_DETECTED", "照片中没有可确认的食物或饮品");
    if (!Array.isArray(r.items) || r.items.length < 1 || r.items.length > 30)
      fail("INVALID_MODEL_OUTPUT", "模型未返回有效食物候选");
    return r.items.map((raw, index) => {
      const x = object(raw);
      keys(x, [
        "candidateIndex",
        "foodId",
        "name",
        "grams",
        "caloriesKcal",
        "carbsG",
        "proteinG",
        "fatG",
        "nutritionSource",
        "confidence",
      ]);
      if (x.candidateIndex !== index || x.nutritionSource !== "model")
        fail("INVALID_MODEL_OUTPUT", "模型候选结构不正确");
      // 模型输出可选foodId不能作为目录关联事实；由目录匹配的受控流程另行赋值。
      const [validated] = foodInputs(
        [
          {
            nutritionSource: "user",
            name: x.name,
            grams: x.grams,
            caloriesKcal: x.caloriesKcal,
            carbsG: x.carbsG,
            proteinG: x.proteinG,
            fatG: x.fatG,
          },
        ],
        false,
      );
      const confidence = x.confidence === null ? null : Number(x.confidence);
      if (
        x.confidence !== null &&
        (typeof x.confidence !== "number" ||
          !Number.isFinite(confidence) ||
          confidence! < 0 ||
          confidence! > 1)
      )
        fail("INVALID_MODEL_OUTPUT", "模型置信度不正确");
      return {
        ...(validated as Extract<FoodItemInput, { nutritionSource: "user" }>),
        foodId: null,
        nutritionSource: "model",
        candidateIndex: index,
        confidence:
          confidence === null ? null : Math.round(confidence * 1000) / 1000,
      };
    });
  }
}
