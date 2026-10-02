// Importance is deterministic. The model supplies bounded event labels, never source counts or dates.
export const IMPORTANCE_RULE_VERSION = "intelligence-v1-55-20-15-10";
export const SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export type Severity = typeof SEVERITIES[number];
export interface IntelligenceLabels {
  severity: Severity;
  historical: boolean;
  diplomacyFlashpoint: boolean;
  entityAction: string | null;
}
export interface ImportanceEvidence {
  publisherKey: string;
  sourceTier: number;
  firstParty: boolean;
  publishedAt: Date | null;
  labels: IntelligenceLabels | null;
}
export interface ImportanceBreakdown {
  score: number;
  base: number;
  severity: Severity;
  severityScore: number;
  sourceTierScore: number;
  corroborationScore: number;
  recencyScore: number;
  independentPublishers: number;
  entitySources: number;
  diplomacyBonus: number;
  entityBonus: number;
  coverage: "classified" | "unclassified";
}
const LEVEL: Record<Severity, number> = { critical: 100, high: 75, medium: 50, low: 25, info: 0 };
const DAY = 86400_000;
export function computeImportance(evidence: ImportanceEvidence[], at: Date): ImportanceBreakdown {
  // A missing date cannot silently acquire the discovery time's freshness.
  const dated = evidence.filter(e => e.publishedAt && Number.isFinite(e.publishedAt.getTime()) && e.publishedAt.getTime() <= at.getTime() + 3600_000 && at.getTime() - e.publishedAt.getTime() <= 96 * 3600_000);
  const independent = new Map<string, ImportanceEvidence>();
  for (const e of dated) {
    const previous = independent.get(e.publisherKey);
    if (!previous || e.sourceTier < previous.sourceTier || (e.sourceTier === previous.sourceTier && e.publishedAt!.getTime() > previous.publishedAt!.getTime())) independent.set(e.publisherKey, e);
  }
  const peers = [...independent.values()];
  const labelled = dated.filter(e => e.labels && !e.labels.historical);
  let severity: Severity = "info";
  for (const e of labelled) if (LEVEL[e.labels!.severity] > LEVEL[severity]) severity = e.labels!.severity;
  // A single unreviewed claim cannot become high/critical through a model alone.
  const established = peers.some(e => e.firstParty || e.sourceTier === 1) || peers.filter(e => e.sourceTier <= 2).length >= 2;
  if (!established && LEVEL[severity] > LEVEL.medium) severity = "medium";
  const pairs = new Map<string, Set<string>>();
  for (const e of labelled) {
    if (!e.labels!.diplomacyFlashpoint || !e.labels!.entityAction || e.sourceTier > 2 || at.getTime() - e.publishedAt!.getTime() > DAY) continue;
    const key = e.labels!.entityAction!;
    if (!pairs.has(key)) pairs.set(key, new Set());
    pairs.get(key)!.add(e.publisherKey);
  }
  const entitySources = Math.max(0, ...[...pairs.values()].map(p => p.size));
  if (entitySources >= 3 && LEVEL[severity] < LEVEL.high) severity = "high";
  const diplomacyBonus = entitySources >= 2 ? 18 : 0;
  const entityBonus = entitySources >= 2 ? Math.min(entitySources, 5) * 4 : 0;
  const sourceTierScore = peers.length ? Math.max(...peers.map(e => ({1:100,2:75,3:50,4:25}[e.sourceTier] ?? 25))) : 0;
  const corroborationScore = Math.min(peers.length, 5) * 20;
  const recencyScore = dated.length ? Math.max(...dated.map(e => Math.max(0, Math.min(1, 1 - (at.getTime() - e.publishedAt!.getTime()) / DAY)) * 100)) : 0;
  const base = Math.round(LEVEL[severity] * .55 + sourceTierScore * .20 + corroborationScore * .15 + recencyScore * .10);
  return {score: base + diplomacyBonus + entityBonus, base, severity, severityScore: LEVEL[severity], sourceTierScore, corroborationScore, recencyScore: Math.round(recencyScore), independentPublishers: peers.length, entitySources, diplomacyBonus, entityBonus, coverage: labelled.length ? "classified" : "unclassified"};
}
