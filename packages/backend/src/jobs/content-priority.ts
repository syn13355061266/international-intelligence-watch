import { isHistorical } from "../content/materials.ts";
import { processingHint } from "@aihot/industry/processing-priority";

export interface PriorityInput {
  backfill: boolean;
  published_at: Date | null;
  discovered_at: Date;
  tier: string;
  score: number | null;
  title?: string;
  excerpt?: string | null;
}

/** Queue order only, never an editorial score: recent news first, history last. */
export function contentPriority(row: PriorityInput, now = Date.now()): number {
  if (isHistorical(row)) return -2;
  const at = Math.min(now, (row.published_at ?? row.discovered_at).getTime());
  const freshness = Math.max(0, 4320 - Math.floor((now - at) / 60_000));
  // Hints, authority and known scores can move a report forward by at most eight hours.
  const authority = row.tier === "T1" ? 60 : row.tier === "T1_5" ? 30 : 0;
  const importance = Math.round(Math.max(0, Math.min(100, row.score ?? 0)) * 1.8);
  const hint = processingHint(`${row.title ?? ""} ${(row.excerpt ?? "").slice(0, 1000)}`);
  return 100 + freshness + authority + importance + hint;
}
