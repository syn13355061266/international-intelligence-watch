/** Shared by single-report selection and event ranking; all inputs require material evidence. */
export const CHINA_RELEVANCE_RULE_VERSION = "china-v1-70-30";
export interface AttentionDimensions { sig: number; nov: number; cred: number; reson: number; act: number }
export interface AttentionAssessment {
  dimensions: AttentionDimensions;
  chinaRelevance: number;
  chinaEvidence: string;
  globalMajor: boolean;
}
export interface AttentionBreakdown extends AttentionAssessment {
  base: number;
  weighted: number;
  globalProtected: boolean;
  qualityCap: number;
  score: number;
}
export function scoreAttention(input: AttentionAssessment): AttentionBreakdown {
  const d = input.dimensions;
  const base = Math.round(d.sig * 5.5 + d.nov * 1.5 + d.cred * 1.5 + d.reson + d.act * .5);
  const chinaRelevance = input.chinaEvidence.trim() ? input.chinaRelevance : 0;
  const weighted = Math.round(base * .7 + chinaRelevance * .3);
  const globalProtected = input.globalMajor && base >= 80 && d.sig >= 8 && d.cred >= 7 && d.nov >= 5;
  const qualityCap = d.cred <= 3 || d.nov <= 2 || d.sig <= 2 ? 30 : d.sig <= 3 ? 40 : 100;
  return { ...input, chinaRelevance, base, weighted, globalProtected, qualityCap,
    score: Math.min(qualityCap, globalProtected ? Math.max(base, weighted) : weighted) };
}

/** A weak report cannot regain influence through the event-level China component. */
export function eventChinaRelevance(assessments: AttentionBreakdown[] | null): number | null {
  if (!Array.isArray(assessments) || !assessments.length) return null;
  if (assessments.some(a => !Number.isFinite(a.chinaRelevance) || !Number.isFinite(a.qualityCap))) return null;
  return assessments.reduce((sum, a) => sum + (a.qualityCap >= 60 ? Math.max(0, Math.min(100, a.chinaRelevance)) : 0), 0) / assessments.length;
}
