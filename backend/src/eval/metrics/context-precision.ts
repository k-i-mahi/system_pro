/**
 * Context precision / recall given a set of expected citation sources.
 * Counts how many of the expected materials show up in the top-K retrieved
 * chunks. Precision = matched / retrieved; recall = matched / expected.
 */
export interface CitationEval {
  retrievedMaterialTitles: string[];
  expectedMaterialTitles: string[];
}

export function contextPrecision({
  retrievedMaterialTitles,
  expectedMaterialTitles,
}: CitationEval) {
  if (expectedMaterialTitles.length === 0) {
    return { precision: 1, recall: 1, matched: retrievedMaterialTitles };
  }
  const retrievedSet = new Set(retrievedMaterialTitles.map((s) => s.toLowerCase()));
  const expectedSet = new Set(expectedMaterialTitles.map((s) => s.toLowerCase()));
  const matched = [...retrievedSet].filter((t) => expectedSet.has(t));
  return {
    precision: matched.length / Math.max(1, retrievedSet.size),
    recall: matched.length / expectedSet.size,
    matched,
  };
}

/**
 * Recall@K: did any expected material appear in the top-K retrieved chunks?
 * Returns 1 if yes, 0 if no — aggregated by caller.
 */
export function recallAtK(
  retrievedMaterialTitles: string[],
  expectedMaterialTitles: string[]
): number {
  if (expectedMaterialTitles.length === 0) return 1;
  const retrievedSet = new Set(retrievedMaterialTitles.map((s) => s.toLowerCase()));
  return expectedMaterialTitles.some((t) => retrievedSet.has(t.toLowerCase())) ? 1 : 0;
}

/**
 * Keyword coverage — simple case-insensitive substring search across the
 * answer. Good baseline when no reference answer is available.
 */
export function keywordCoverage(answer: string, keywords: string[]): number {
  if (keywords.length === 0) return 1;
  const lower = answer.toLowerCase();
  const hits = keywords.filter((k) => lower.includes(k.toLowerCase()));
  return hits.length / keywords.length;
}
