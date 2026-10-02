import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { sql } from "../db.ts";
import { QUEUES, work } from "./queue.ts";
import { chatJson, markReceiptsCompleted } from "../providers/llm.ts";
import { activeConnection, queueConnectionTask } from "../providers/model-connections.ts";
import { modelErrorMessage } from "../providers/model-errors.ts";
import { collectSource } from "../sources/collect.ts";

export async function runConnectionTask(taskId: string) {
  const [task] = await sql<{ id: string; connection_id: string; kind: "verify" | "bootstrap" }[]>`UPDATE model_connection_tasks SET status='running',updated_at=now() WHERE id=${taskId} AND status='queued' RETURNING id,connection_id,kind`;
  if (!task) return;
  try {
    let detail: unknown;
    if (task.kind === "verify") {
      const result = await chatJson({ model: "default", connectionId: task.connection_id, purpose: "model_connection_verify", subject: `connection:${task.connection_id}`, promptVersion: "connection-verify-v1", system: 'Return exactly one JSON object: {"ok":true}. No explanation.', user: "Confirm that you can answer this request.", schema: z.object({ ok: z.literal(true) }), maxTokens: 512, timeoutMs: 90_000, attemptTag: task.id });
      await markReceiptsCompleted([result.receiptId]);
      await sql`UPDATE model_connections SET verified_at=now() WHERE id=${task.connection_id}`;
      detail = { receiptId: result.receiptId, usage: result.usage };
    } else {
      if ((await activeConnection())?.id !== task.connection_id) throw new Error("Model is no longer the active connection");
      // A bounded first batch proves the full pipeline without importing hundreds of feeds at once.
      const results = [];
      for (const id of ["intel-rss-bbc-world-full", "intel-rss-guardian-world-full", "intel-official-council-press"]) {
        const [source] = await sql`SELECT id FROM sources WHERE id=${id} AND kind='rss' AND enabled`;
        if (source) results.push(await collectSource(id, { force: true, initialLimit: 3 }));
      }
      if (!results.some((r) => r.status === "ok")) throw new Error("Source network unavailable");
      detail = { sources: results.map(({ sourceId, status, found, created }) => ({ sourceId, status, found, created })), message: "已采集真实来源，文章正在分析与发布。" };
    }
    await sql`UPDATE model_connection_tasks SET status='complete',detail=${sql.json(detail as never)},updated_at=now() WHERE id=${taskId}`;
    if (task.kind === "verify" && (await activeConnection())?.id === task.connection_id) await queueConnectionTask(task.connection_id, "bootstrap", "worker:model-connection");
  } catch (error) {
    await sql`UPDATE model_connection_tasks SET status='failed',error=${modelErrorMessage(error)},updated_at=now() WHERE id=${taskId}`;
  }
}
export async function registerModelConnectionJobs(boss: PgBoss) {
  await work(boss, QUEUES.connectionTask, { localConcurrency: 1, pollingIntervalSeconds: 2 }, (data) => runConnectionTask(data.taskId));
}
