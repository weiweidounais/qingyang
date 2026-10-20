import { randomUUID } from "node:crypto";
import type { UnitOfWork, MediaPort } from "../../../contracts/shared-types.js";
import { NutritionService } from "./nutrition.service.js";
import { DomainError, uuid } from "./domain.js";

export interface VisionPort {
  provider: string;
  model: string;
  /** 不应自动重试结果不明的收费调用；如支持供应商幂等，以requestKey去重。 */
  recognize(input: {
    readUrl: string;
    requestKey: string;
    signal: AbortSignal;
  }): Promise<unknown>;
}
export class RecognitionWorker {
  private stopping = false;
  private calls = new Set<AbortController>();
  constructor(
    private uow: UnitOfWork,
    private media: MediaPort,
    private nutrition: NutritionService,
    private vision: VisionPort,
    private leaseSeconds = 90,
  ) {}
  stop() {
    this.stopping = true;
    for (const call of this.calls) call.abort();
  }
  async run(jobId: string) {
    if (this.stopping) return;
    uuid(jobId);
    const token = randomUUID();
    const job = await this.uow.runSystem("provider_job", async (tx, ctx) => {
      const [row] = await tx.query<Record<string, any>>(
        "SELECT * FROM recognition_jobs WHERE id=? AND status='queued' FOR UPDATE",
        [jobId],
      );
      if (!row) return null;
      await tx.execute(
        "UPDATE recognition_jobs SET status='running',run_token=?,lease_until=?,started_at=?,attempts=attempts+1,provider=?,model=? WHERE id=? AND status='queued'",
        [
          token,
          new Date(Date.parse(ctx.operationNow) + this.leaseSeconds * 1000),
          new Date(ctx.operationNow),
          this.vision.provider,
          this.vision.model,
          jobId,
        ],
      );
      return row;
    });
    if (!job) return;
    const call = new AbortController();
    this.calls.add(call);
    if (this.stopping) call.abort();
    try {
      const { readUrl } = await this.media.createReadUrl({
        assetId: job.asset_id,
        purpose: "meal_photo",
        actorUserId: job.user_id,
        access: "owner",
        expiresInSeconds: 300,
      });
      const raw = await this.vision.recognize({
        readUrl,
        requestKey: jobId,
        signal: AbortSignal.any([call.signal, AbortSignal.timeout((this.leaseSeconds - 5) * 1000)]),
      });
      const items = this.nutrition.validateCandidates(raw);
      await this.uow.runSystem("provider_job", (tx, ctx) =>
        tx.execute(
          "UPDATE recognition_jobs SET status='succeeded',result=?,completed_at=?,lease_until=NULL WHERE id=? AND status='running' AND run_token=? AND lease_until>?",
          [
            JSON.stringify({ items }),
            new Date(ctx.operationNow),
            jobId,
            token,
            new Date(ctx.operationNow),
          ],
        ),
      );
    } catch (error) {
      const code = error instanceof DomainError && error.code === "NO_FOOD_DETECTED"
        ? "NO_FOOD_DETECTED" : "RECOGNITION_FAILED";
      await this.uow.runSystem("provider_job", (tx, ctx) =>
        tx.execute(
          "UPDATE recognition_jobs SET status='failed',error_code=?,completed_at=?,lease_until=NULL WHERE id=? AND status='running' AND run_token=? AND lease_until>?",
          [
            code,
            new Date(ctx.operationNow),
            jobId,
            token,
            new Date(ctx.operationNow),
          ],
        ),
      );
    } finally { this.calls.delete(call); }
  }
  async recoverExpired() {
    return this.uow.runSystem("provider_job", async (tx, ctx) => {
      const expired = await tx.query<Record<string, any>>(
        "SELECT id,run_token FROM recognition_jobs WHERE status='running' AND lease_until<=? ORDER BY id FOR UPDATE SKIP LOCKED",
        [new Date(ctx.operationNow)],
      );
      for (const row of expired)
        await tx.execute(
          "UPDATE recognition_jobs SET status='failed',error_code='RECOGNITION_LEASE_EXPIRED',completed_at=?,lease_until=NULL WHERE id=? AND status='running' AND run_token=? AND lease_until<=?",
          [
            new Date(ctx.operationNow),
            row.id,
            row.run_token,
            new Date(ctx.operationNow),
          ],
        );
      return expired.length;
    });
  }
}
