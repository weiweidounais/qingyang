/** 单进程本机调度，使用数据库Outbox持久化；不作为M01生产运行壳。 */
import { randomUUID } from "node:crypto";
import type { OutboxPort } from "../../../../contracts/shared-types.js";
import { RecognitionWorker } from "../recognition.worker.js";
import { LocalRuntime } from "./runtime.js";

export function localOutbox(): OutboxPort {
  return { enqueueInTransaction: async (tx, event) => {
    const id = randomUUID();
    await tx.execute("INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,event_key,schema_version,payload) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id",
      [id, event.eventType, event.aggregateType, event.aggregateId, event.eventKey, event.schemaVersion, JSON.stringify(event.payload)]);
    const [row] = await tx.query<{ id: string }>("SELECT id FROM outbox_events WHERE event_key=?", [event.eventKey]);
    return { id: row.id };
  } };
}
export function startLocalRecognition(runtime: LocalRuntime, worker: RecognitionWorker) {
  let active = false, stopped = false;
  async function tick() {
    if (active || stopped) return;
    active = true;
    try {
      await worker.recoverExpired();
      await runtime.runSystem("outbox_claim", (tx) => tx.execute("UPDATE outbox_events e JOIN recognition_jobs j ON e.aggregate_id=j.id SET e.status='published',e.published_at=UTC_TIMESTAMP(3) WHERE e.event_type='nutrition.recognition.requested.v1' AND e.status='pending' AND j.status IN ('succeeded','failed','canceled')", []));
      // Worker自身对queued做事务领取。进程重启后queued自动续派；running只回收、不重调用模型。
      const [job] = await runtime.readSnapshot((tx) => tx.query<{ id: string }>("SELECT id FROM recognition_jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1", []));
      if (!job || stopped) return;
      await worker.run(job.id);
      await runtime.runSystem("outbox_claim", (tx) => tx.execute("UPDATE outbox_events SET status='published',published_at=UTC_TIMESTAMP(3) WHERE aggregate_id=? AND event_type='nutrition.recognition.requested.v1' AND status='pending'", [job.id]));
    } catch (error) { console.error("M03 local worker", (error as Error).name); }
    finally { active = false; }
  }
  const timer = setInterval(() => void tick(), 1000);
  return async () => {
    stopped = true; clearInterval(timer); worker.stop();
    // Keep the pool alive until the short bounded model call has settled.
    while (active) await new Promise((resolve) => setTimeout(resolve, 100));
  };
}
