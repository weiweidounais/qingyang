/** 仅本地集成夹具：M01鉴权/事务/幂等与M05端口的替身，禁止生产使用。 */
import { createPool, type Pool, type PoolConnection } from "mysql2/promise";
import { randomUUID, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type {
  SqlTx,
  CommandContext,
  UnitOfWork,
} from "../../../../contracts/shared-types.js";
import { bodyHash, businessDate, DomainError, fail, uuid } from "../domain.js";
export const projectRoot = fileURLToPath(
  new URL("../../../../../", import.meta.url),
).replace(/\/$/, "");
export const users = {
  a: "a0000000-0000-4000-8000-000000000001",
  b: "a0000000-0000-4000-8000-000000000002",
};
type Reply = { status: number; data: unknown };
export class LocalRuntime implements UnitOfWork {
  pool: Pool;
  constructor(
    public config: {
      password: string;
      socketPath: string;
      cursorSecret: string;
      sessionSecret: string;
      database: string;
    },
  ) {
    if (process.env.NODE_ENV === "production")
      throw Error("M03本地联调入口禁止在生产启动，请装配M01/M05真实端口");
    this.pool = createPool({
      user: "root",
      password: config.password,
      socketPath: config.socketPath,
      database: config.database,
      timezone: "Z",
      dateStrings: ["DATE"],
      connectionLimit: 8,
      multipleStatements: false,
    });
  }
  async connect() {
    const c = await this.pool.getConnection();
    await c.query("SET time_zone='+00:00'");
    return c;
  }
  tx(c: PoolConnection): SqlTx {
    return {
      query: async <T extends object>(sql: string, values: readonly any[]) =>
        (await c.query(sql, [...values]))[0] as T[],
      execute: async (sql: string, values: readonly any[]) => {
        const [r] = await c.query(sql, [...values]);
        return { affectedRows: (r as any).affectedRows };
      },
    };
  }
  ctx(userId: string): CommandContext {
    const now = new Date().toISOString();
    return {
      userId,
      operationNow: now,
      businessDate: businessDate(now),
      requestId: randomUUID(),
      platform: "h5",
    };
  }
  async readSnapshot<T>(run: (tx: SqlTx) => Promise<T>) {
    const c = await this.connect();
    try {
      await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await c.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
      const r = await run(this.tx(c));
      await c.commit();
      return r;
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }
  async runForUser<T>(
    userId: string,
    run: (tx: SqlTx, ctx: CommandContext) => Promise<T>,
  ) {
    return this.runForUsers(userId, [], run);
  }
  async runForUsers<T>(
    actor: string,
    refs: readonly string[],
    run: (tx: SqlTx, ctx: CommandContext) => Promise<T>,
  ) {
    const c = await this.connect();
    try {
      await c.beginTransaction();
      const tx = this.tx(c);
      for (const id of [...new Set([actor, ...refs])].sort()) {
        const rows = await tx.query(
          "SELECT id FROM users WHERE id=? FOR UPDATE",
          [uuid(id)],
        );
        if (!rows.length) fail("NOT_FOUND", "账号不存在", 404);
      }
      const r = await run(tx, this.ctx(actor));
      await c.commit();
      return r;
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }
  async runSystem<T>(
    _scope: Parameters<UnitOfWork["runSystem"]>[0],
    run: (
      tx: SqlTx,
      ctx: { operationNow: string; requestId: string },
    ) => Promise<T>,
  ) {
    const c = await this.connect();
    try {
      await c.beginTransaction();
      const now = new Date().toISOString();
      const r = await run(this.tx(c), {
        operationNow: now,
        requestId: randomUUID(),
      });
      await c.commit();
      return r;
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }
  async command(
    userId: string,
    method: string,
    path: string,
    key: string,
    body: unknown,
    fn: (tx: SqlTx, ctx: CommandContext) => Promise<Reply>,
  ): Promise<Reply> {
    uuid(key);
    const hash = bodyHash(body),
      principal = `user:${userId}`,
      owner = randomUUID();
    const claim = await this.runSystem("idempotency_claim", async (tx, ctx) => {
      await tx.execute(
        "INSERT INTO idempotency_requests (id,principal_key,method,request_path,idempotency_key,body_hash,status,expires_at,locked_by,locked_until,lease_version) VALUES (?,?,?,?,?,?,'processing',?,?,?,1) ON DUPLICATE KEY UPDATE id=id",
        [
          randomUUID(),
          principal,
          method,
          path,
          key,
          hash,
          new Date(Date.parse(ctx.operationNow) + 86400000),
          owner,
          new Date(Date.parse(ctx.operationNow) + 60000),
        ],
      );
      const [r] = await tx.query<Record<string, any>>(
        "SELECT * FROM idempotency_requests WHERE principal_key=? AND method=? AND request_path=? AND idempotency_key=? FOR UPDATE",
        [principal, method, path, key],
      );
      if (r.body_hash !== hash)
        fail("IDEMPOTENCY_CONFLICT", "同一次保存的内容已变化，请重新提交", 409);
      if (r.status === "completed")
        return {
          reply: {
            status: r.response_status,
            data:
              typeof r.response_body === "string"
                ? JSON.parse(r.response_body)
                : r.response_body,
          },
        };
      if (
        r.locked_by !== owner &&
        r.status === "processing" &&
        new Date(r.locked_until).getTime() > Date.now()
      )
        fail("REQUEST_IN_PROGRESS", "这次保存仍在处理中，请稍后重试", 409);
      if (r.locked_by !== owner) {
        await tx.execute(
          "UPDATE idempotency_requests SET status='processing',locked_by=?,locked_until=?,lease_version=lease_version+1,response_status=NULL,response_body=NULL WHERE id=?",
          [owner, new Date(Date.parse(ctx.operationNow) + 60000), r.id],
        );
        r.lease_version++;
      }
      return { id: r.id as string, version: Number(r.lease_version) };
    });
    if ("reply" in claim) return claim.reply!;
    try {
      // 只能重试完整业务事务，不能只补发积分或单条写入。
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await this.runForUser(userId, async (tx, ctx) => {
            const [r] = await tx.query<Record<string, any>>(
              "SELECT * FROM idempotency_requests WHERE id=? FOR UPDATE",
              [claim.id!],
            );
            if (
              r.status !== "processing" ||
              r.locked_by !== owner ||
              Number(r.lease_version) !== claim.version ||
              new Date(r.locked_until).getTime() <= Date.parse(ctx.operationNow)
            )
              fail("REQUEST_IN_PROGRESS", "保存租约已失效，请重试", 409);
            const reply = await fn(tx, ctx);
            await tx.execute(
              "UPDATE idempotency_requests SET status='completed',locked_by=NULL,locked_until=NULL,response_status=?,response_body=? WHERE id=? AND locked_by=? AND lease_version=?",
              [
                reply.status,
                JSON.stringify(reply.data),
                claim.id!,
                owner,
                claim.version!,
              ],
            );
            return reply;
          });
        } catch (e) {
          if (
            attempt < 2 &&
            ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(
              (e as any).code,
            )
          )
            continue;
          throw e;
        }
      }
      throw Error("unreachable");
    } catch (e) {
      await this.runSystem("idempotency_claim", (tx) =>
        tx.execute(
          "UPDATE idempotency_requests SET status='failed',locked_by=NULL,locked_until=NULL,response_status=?,response_body=? WHERE id=? AND status='processing' AND locked_by=? AND lease_version=?",
          [
            e instanceof DomainError ? e.status : 500,
            JSON.stringify(null),
            claim.id!,
            owner,
            claim.version!,
          ],
        ),
      );
      throw e;
    }
  }
  sign(value: string) {
    return createHmac("sha256", this.config.sessionSecret)
      .update(value)
      .digest("base64url");
  }
}
export async function loadRuntime() {
  const config = JSON.parse(
    await readFile(`${projectRoot}/.local/m03-db.json`, "utf8"),
  );
  return new LocalRuntime(config);
}
