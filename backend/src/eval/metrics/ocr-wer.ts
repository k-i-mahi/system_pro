import { request } from 'undici';
import { env } from '../../config/env.js';

/**
 * Delegate WER/CER scoring to the Python sidecar (jiwer is more accurate than
 * hand-rolled Levenshtein on tokenization edge cases). Falls back to a pure
 * Levenshtein CER if the sidecar is unreachable.
 */
export async function ocrMetrics(
  prediction: string,
  reference: string
): Promise<{ cer: number; wer: number; source: 'sidecar' | 'fallback' }> {
  try {
    const { statusCode, body } = await request(`${env.AI_SIDECAR_URL}/eval/wer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prediction, reference }),
      headersTimeout: 10_000,
    });
    if (statusCode < 400) {
      const json = (await body.json()) as { cer: number; wer: number };
      return { cer: json.cer, wer: json.wer, source: 'sidecar' };
    }
  } catch {
    // fall through
  }
  return { cer: fallbackCer(prediction, reference), wer: NaN, source: 'fallback' };
}

function fallbackCer(pred: string, ref: string): number {
  if (!ref) return pred ? 1 : 0;
  const m = pred.length;
  const n = ref.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = pred[i - 1] === ref[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n] / n;
}
