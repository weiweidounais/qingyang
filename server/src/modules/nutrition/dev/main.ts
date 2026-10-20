import "reflect-metadata";
import { All, Controller, Module, Req, Res } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { raw, json, type Request, type Response } from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { NutritionService } from "../nutrition.service.js";
import { RestaurantsService } from "../../restaurants/restaurants.service.js";
import { AmapMcpPoi } from "../../restaurants/amap-mcp.js";
import {
  CursorCodec,
  DomainError,
  fail,
  keys,
  object,
  uuid,
} from "../domain.js";
import { loadRuntime, projectRoot, users } from "./runtime.js";
import type {
  PointsPort,
  OutboxPort,
} from "../../../../contracts/shared-types.js";

import { LocalMedia, MAX_PHOTO_BYTES } from "./local-media.js";
import { localOutbox, startLocalRecognition } from "./local-recognition.js";
import { OllamaVision } from "../ollama-vision.js";
import { RecognitionWorker } from "../recognition.worker.js";
const runtime = await loadRuntime();
// 测试装配明确不结算积分：不能用于M05原子发奖验收。
const points: PointsPort = {
  ensureAccountInTransaction: async () => ({
    balance: 0,
    lifetimeEarned: 0,
    lifetimeSpent: 0,
    version: 0,
  }),
  awardInTransaction: async () => ({
    awards: [],
    account: { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0, version: 0 },
  }),
};
const outbox: OutboxPort = localOutbox();
const media = new LocalMedia(runtime);
await media.initialize();
const vision = new OllamaVision("qwen3-vl:4b-instruct", async (readUrl, signal) => {
  signal.throwIfAborted();
  const u = new URL(readUrl, "http://127.0.0.1:3012");
  const match = /^\/api\/v1\/uploads\/([^/]+)\/content$/.exec(u.pathname);
  if (u.origin !== "http://127.0.0.1:3012" || u.username || u.password || !match || [...u.searchParams.keys()].some((k) => k !== "token")) throw Error("不受支持的媒体读取地址");
  const { bytes } = await media.content(match[1], u.searchParams.get("token") ?? "");
  signal.throwIfAborted();
  return bytes;
});
const cursors = new CursorCodec(runtime.config.cursorSecret);
const nutrition = new NutritionService({ points, outbox, media, cursors });
let amap: AmapMcpPoi | null = null;
try {
  const config = JSON.parse(await readFile(`${projectRoot}/.local/m03-amap.json`, "utf8"));
  amap = new AmapMcpPoi(config.apiKey);
  await amap.initialize();
} catch { console.warn("高德MCP未就绪，附近餐饮暂不可用；未输出凭据或上游错误。"); }
const restaurants = new RestaurantsService(cursors, amap?.isReady() ? amap : null);
const worker = new RecognitionWorker(runtime, media, nutrition, vision, 180);
const cookies = (req: Request): Record<string, string> =>
  Object.fromEntries(
    (req.headers.cookie ?? "")
      .split(";")
      .map((x) => x.trim().split("="))
      .filter((x) => x.length === 2),
  );
function safeEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function authenticated(req: Request) {
  const token = cookies(req).qym03_session;
  if (!token) return fail("UNAUTHORIZED", "请先选择本地联调账号", 401);
  const [userId, expiry, signature] = token.split(".");
  if (
    !Object.values(users).includes(userId) ||
    Number(expiry) < Date.now() ||
    !safeEqual(signature ?? "", runtime.sign(`${userId}.${expiry}`))
  )
    fail("UNAUTHORIZED", "本地会话已失效，请重新选择账号", 401);
  return userId;
}
function csrf(req: Request) {
  const header = req.headers["x-csrf-token"],
    cookie = cookies(req).qym03_csrf;
  if (typeof header !== "string" || !cookie || !safeEqual(header, cookie))
    fail("CSRF_INVALID", "请求验证已失效，请刷新后重试", 403);
  const origin = req.headers.origin;
  if (origin) {
    const u = new URL(origin);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      !(u.port === "3001" || (u.port === "3443" && u.protocol === "https:")) ||
      !/^(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/.test(
        u.hostname,
      )
    )
      fail("ORIGIN_INVALID", "请求来源不受支持", 403);
  }
}
const meta = () => ({
  requestId: randomUUID(),
  serverTime: new Date().toISOString(),
  timezone: "Asia/Shanghai",
});
class ApiController {
  async handle(req: Request, res: Response) {
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const path = req.path.replace(/^\/api\/v1/, ""),
        method = req.method;
      const q = Object.fromEntries(
        Object.entries(req.query).map(([k, v]) => {
          if (typeof v !== "string")
            fail("INVALID_QUERY", "查询参数格式不正确");
          return [k, v];
        }),
      ) as Record<string, string>;
      if (method === "GET" && path === "/auth/csrf") {
        const token = randomUUID();
        res.cookie("qym03_csrf", token, {
          httpOnly: true,
          sameSite: "lax",
          path: "/api/v1",
          maxAge: 86400000,
        });
        return res.json({ data: { csrfToken: token }, meta: meta() });
      }
      if (method === "GET" && path === "/__dev/capabilities")
        return res.json({
          data: {
            mode: "local_fixture",
            upload: true,
            recognition: await vision.available(),
            recognitionProvider: "ollama-local",
            recognitionModel: vision.model,
            poi: !!amap?.isReady(),
            poiProvider: amap?.isReady() ? "amap-mcp" : null,
            poiFavorites: !amap?.isReady(),
            points: false,
            dashboard: false,
            timezone: "Asia/Shanghai",
          },
          meta: meta(),
        });
      if (method === "GET" && path === "/meta/contract") {
        const applied = JSON.parse(
          await readFile(
            `${projectRoot}/.local/m03-baseline-applied.json`,
            "utf8",
          ),
        );
        return res.json({
          data: {
            contractVersion: "QY-MYSQL-1.0.0",
            ...applied,
            timezone: "Asia/Shanghai",
          },
          meta: meta(),
        });
      }
      const binaryMatch = /^\/uploads\/([^/]+)\/binary$/.exec(path);
      if (method === "PUT" && binaryMatch) {
        keys(q, ["token"]);
        await media.receive(binaryMatch[1], q.token ?? "", req.body, req.headers["content-type"] ?? "");
        return res.status(204).end();
      }
      const contentMatch = /^\/uploads\/([^/]+)\/content$/.exec(path);
      if (method === "GET" && contentMatch) {
        keys(q, ["token"]);
        const content = await media.content(contentMatch[1], q.token ?? "");
        res.setHeader("Content-Type", content.contentType);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy", "default-src 'none'");
        return res.send(content.bytes);
      }
      if (method !== "GET") {
        if (req.headers["x-client-platform"] !== "h5")
          fail("INVALID_PLATFORM", "请使用统一H5请求头");
        csrf(req);
      }
      if (method === "POST" && path === "/__dev/session") {
        const b = object(req.body);
        keys(b, ["fixture"]);
        if (b.fixture !== "a" && b.fixture !== "b")
          fail("INVALID_FIXTURE", "请选择本地联调账号");
        const userId = users[b.fixture],
          expiry = String(Date.now() + 86400000);
        res.cookie(
          "qym03_session",
          `${userId}.${expiry}.${runtime.sign(`${userId}.${expiry}`)}`,
          {
            httpOnly: true,
            sameSite: "lax",
            path: "/api/v1",
            maxAge: 86400000,
          },
        );
        return res.json({
          data: {
            userId,
            nickname: `本地测试账号${b.fixture.toUpperCase()}`,
            localFixture: true,
          },
          meta: meta(),
        });
      }
      const userId = authenticated(req);
      const modelReady = method === "POST" && path === "/me/recognition-jobs" ? await vision.available() : false;
      let result: { status: number; data: unknown };
      if (method === "GET") {
        if (path === "/restaurants/nearby") {
          const data = await restaurants.search(userId, q,
            (run) => runtime.readSnapshot(run),
            (run) => runtime.runForUser(userId, (tx) => run(tx)));
          return res.json({ data, meta: meta() });
        }
        const data = await runtime.readSnapshot(async (tx) => {
          if (path === "/me")
            return {
              userId,
              nickname: `本地测试账号${userId === users.a ? "A" : "B"}`,
              localFixture: true,
            };
          if (/^\/uploads\/[^/]+$/.test(path)) {
            keys(q, []);
            const asset = await media.asset(tx, path.split("/").at(-1)!, userId);
            return { assetId: asset.id, status: asset.status, errorCode: asset.error_code };
          }
          if (path === "/foods") return nutrition.foods(tx, q);
          if (path === "/me/meals") return nutrition.list(tx, userId, q);
          if (/^\/me\/meals\/[^/]+$/.test(path)) {
            keys(q, []);
            return nutrition.get(tx, userId, path.split("/").at(-1)!);
          }
          if (/^\/me\/recognition-jobs\/[^/]+$/.test(path)) {
            keys(q, []);
            return nutrition.job(tx, userId, path.split("/").at(-1)!);
          }
          if (path === "/me/restaurant-favorites")
            return restaurants.favorites(tx, userId, q);
          if (/^\/restaurants\/[^/]+$/.test(path))
            return restaurants.get(tx, userId, path.split("/").at(-1)!, q);
          fail("NOT_FOUND", "接口不存在", 404);
        });
        result = { status: 200, data };
      } else {
        const key = req.headers["idempotency-key"];
        if (typeof key !== "string")
          fail("IDEMPOTENCY_KEY_REQUIRED", "保存需要幂等请求编号");
        uuid(key);
        result = await runtime.command(
          userId,
          method,
          path,
          key,
          req.body ?? null,
          async (tx, ctx) => {
            keys(q, []);
            if (method === "POST" && path === "/uploads/presign")
              return { status: 201, data: await media.presign(tx, ctx, req.body) };
            if (method === "POST" && /^\/uploads\/[^/]+\/complete$/.test(path))
              return { status: 200, data: await media.complete(tx, userId, path.split("/").at(-2)!, req.body) };
            if (method === "POST" && path === "/me/meals")
              return {
                status: 201,
                data: await nutrition.create(tx, ctx, req.body),
              };
            if (method === "PATCH" && /^\/me\/meals\/[^/]+$/.test(path))
              return {
                status: 200,
                data: await nutrition.update(
                  tx,
                  ctx,
                  path.split("/").at(-1)!,
                  req.body,
                ),
              };
            if (method === "DELETE" && /^\/me\/meals\/[^/]+$/.test(path)) {
              if (req.body && Object.keys(req.body).length)
                fail("UNKNOWN_FIELD", "删除请求无需正文");
              await nutrition.remove(tx, ctx, path.split("/").at(-1)!);
              return { status: 204, data: null };
            }
            if (method === "POST" && path === "/me/recognition-jobs") {
              const b = object(req.body);
              await media.assertReady(tx, { assetId: uuid(b.assetId), actorUserId: userId, purpose: "meal_photo", access: "owner" });
              if (!modelReady) fail("LOCAL_MODEL_UNAVAILABLE", "本机视觉模型未就绪，请先启动Ollama并下载模型", 503);
              return { status: 202, data: await nutrition.createJob(tx, ctx, req.body) };
            }
            if (
              method === "POST" &&
              /^\/me\/recognition-jobs\/[^/]+\/cancel$/.test(path)
            ) {
              if (req.body && Object.keys(req.body).length)
                fail("UNKNOWN_FIELD", "取消请求无需正文");
              return {
                status: 200,
                data: await nutrition.cancelJob(
                  tx,
                  ctx,
                  path.split("/").at(-2)!,
                ),
              };
            }
            if (
              (method === "PUT" || method === "DELETE") &&
              /^\/me\/restaurant-favorites\/[^/]+$/.test(path)
            ) {
              if (req.body && Object.keys(req.body).length)
                fail("UNKNOWN_FIELD", "收藏请求无需正文");
              return {
                status: method === "PUT" ? 200 : 204,
                data: await restaurants.favorite(
                  tx,
                  ctx,
                  path.split("/").at(-1)!,
                  method === "PUT",
                ),
              };
            }
            if (path.startsWith("/uploads"))
              fail(
                "UPLOAD_NOT_CONFIGURED",
                "公共上传服务尚未接入，照片目前仅在设备预览",
                503,
              );
            fail("NOT_FOUND", "接口不存在", 404);
          },
        );
      }
      if (method === "GET" && /^\/me\/meals\/[^/]+$/.test(path))
        result.data = await nutrition.withPhoto(result.data as import("../../../../contracts/shared-types.js").MealDto, userId);
      return result.status === 204
        ? res.status(204).end()
        : res.status(result.status).json({ data: result.data, meta: meta() });
    } catch (e) {
      if (!(e instanceof DomainError))
        console.error(
          "M03 request failed",
          (e as any).code ?? (e as any).message,
        );
      const err =
        e instanceof DomainError
          ? e
          : new DomainError(
              "INTERNAL_ERROR",
              "暂时无法完成，请稍后重试；输入内容已保留",
              500,
            );
      return res
        .status(err.status)
        .json({
          error: { code: err.code, message: err.message },
          meta: meta(),
        });
    }
  }
}
Controller("api/v1")(ApiController);
All("{*path}")(
  ApiController.prototype,
  "handle",
  Object.getOwnPropertyDescriptor(ApiController.prototype, "handle")!,
);
Req()(ApiController.prototype, "handle", 0);
Res()(ApiController.prototype, "handle", 1);
class LocalModule {}
Module({ controllers: [ApiController] })(LocalModule);
const app = await NestFactory.create(LocalModule, {
  logger: ["warn", "error"],
  bodyParser: false,
});
app.use(/^\/api\/v1\/uploads\/[^/]+\/binary$/, raw({ type: () => true, limit: MAX_PHOTO_BYTES }));
app.use(json({ limit: "64kb" }));
await app.listen(3012, "127.0.0.1");
const stopRecognition = startLocalRecognition(runtime, worker);
console.log(
  `M03本地联调API http://127.0.0.1:3012/api/v1（测试账号；M01/M02/M05待接入；本机上传与Ollama已装配；高德MCP${amap?.isReady() ? "已接入" : "未就绪"}）`,
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, async () => {
    await stopRecognition();
    await app.close();
    await runtime.pool.end();
    process.exit(0);
  });
