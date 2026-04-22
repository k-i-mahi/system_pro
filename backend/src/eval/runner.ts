/**
 * Evaluation runner — `npm run eval` / `npm run eval:smoke`.
 *
 * Reads backend/src/eval/fixtures/golden-rag.jsonl, runs each question through
 * the RAG answer service, and computes faithfulness, recall@K, keyword
 * coverage. OCR fixtures are scored separately via the ai-sidecar.
 *
 * Output: JSON summary to stdout + human-readable markdown table. The CI
 * smoke mode runs only 3 items so PR cycles stay under a minute.
 */
import fs from 'fs';
import path from 'path';
import { answerWithCitations } from '../services/rag/answer.service.js';
import { extractTextFromFile } from '../services/ocr.service.js';
import { faithfulness } from './metrics/faithfulness.js';
import { keywordCoverage, recallAtK } from './metrics/context-precision.js';
import { ocrMetrics } from './metrics/ocr-wer.js';
import { logger } from '../services/observability/logger.js';

const __dirname = path.dirname(__filename);

interface RagFixture {
  id: string;
  question: string;
  courseCode?: string;
  courseId?: string;
  expectedKeywords: string[];
  expectedCitationMaterialTitles: string[];
  minChunkOverlap?: number;
}

interface RagScore {
  id: string;
  question: string;
  faithfulness: number;
  keywordCoverage: number;
  recallAtK: number;
  chunks: number;
  latencyMs: number;
  answer: string;
  citations: string[];
}

async function runRagSuite(smoke: boolean): Promise<RagScore[]> {
  const file = path.resolve(__dirname, 'fixtures/golden-rag.jsonl');
  const lines = fs
    .readFileSync(file, 'utf-8')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  const fixtures = lines.map((l) => JSON.parse(l) as RagFixture);
  const subset = smoke ? fixtures.slice(0, 3) : fixtures;

  const scores: RagScore[] = [];
  for (const f of subset) {
    const started = Date.now();
    const result = await answerWithCitations(f.question, {
      scope: { courseId: f.courseId },
    });
    const latencyMs = Date.now() - started;
    const retrievedTitles = result.citations.map((c) => c.materialTitle);
    const contexts = result.chunks.map((c) => c.content);

    const faith = contexts.length
      ? await faithfulness(f.question, result.answer, contexts)
      : { score: 0 };
    const keyword = keywordCoverage(result.answer, f.expectedKeywords);
    const recall = recallAtK(retrievedTitles, f.expectedCitationMaterialTitles);

    scores.push({
      id: f.id,
      question: f.question,
      faithfulness: faith.score,
      keywordCoverage: keyword,
      recallAtK: recall,
      chunks: result.chunks.length,
      latencyMs,
      answer: result.answer,
      citations: retrievedTitles,
    });
    logger.info(
      { id: f.id, faith: faith.score, kw: keyword, recall, latencyMs },
      'eval.rag.row'
    );
  }
  return scores;
}

interface OcrScore {
  file: string;
  cer: number;
  wer: number;
  engine: string;
}

async function runOcrSuite(): Promise<OcrScore[]> {
  const dir = path.resolve(__dirname, 'fixtures/golden-ocr');
  if (!fs.existsSync(dir)) return [];
  const images = fs.readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f));
  const scores: OcrScore[] = [];
  for (const img of images) {
    const base = img.replace(/\.(png|jpe?g)$/i, '');
    const refPath = path.join(dir, `${base}.txt`);
    if (!fs.existsSync(refPath)) continue;
    const reference = fs.readFileSync(refPath, 'utf-8').trim();
    const ocr = await extractTextFromFile(path.join(dir, img), 'accurate');
    const m = await ocrMetrics(ocr.text.trim(), reference);
    scores.push({ file: img, cer: m.cer, wer: m.wer, engine: ocr.engine });
    logger.info({ img, cer: m.cer, wer: m.wer }, 'eval.ocr.row');
  }
  return scores;
}

function renderMarkdown(rag: RagScore[], ocr: OcrScore[]): string {
  const ragLines = rag.map(
    (r) =>
      `| ${r.id} | ${r.question.slice(0, 50)}… | ${r.faithfulness.toFixed(2)} | ${r.keywordCoverage.toFixed(2)} | ${r.recallAtK} | ${r.chunks} | ${r.latencyMs} |`
  );
  const avgFaith = avg(rag.map((r) => r.faithfulness));
  const avgKw = avg(rag.map((r) => r.keywordCoverage));
  const avgRecall = avg(rag.map((r) => r.recallAtK));

  const ocrLines = ocr.map(
    (o) => `| ${o.file} | ${o.engine} | ${o.cer.toFixed(3)} | ${Number.isNaN(o.wer) ? 'n/a' : o.wer.toFixed(3)} |`
  );
  const avgCer = avg(ocr.map((o) => o.cer));

  return [
    '# Cognitive Copilot — Evaluation Report',
    '',
    `Run at: ${new Date().toISOString()}`,
    '',
    '## RAG (golden-rag.jsonl)',
    '',
    `Average faithfulness: **${avgFaith.toFixed(3)}**, keyword coverage: **${avgKw.toFixed(3)}**, recall@K: **${avgRecall.toFixed(3)}**`,
    '',
    '| ID | Question | Faith | Keyword | Recall@K | Chunks | Latency ms |',
    '|----|----------|-------|---------|----------|--------|------------|',
    ...ragLines,
    '',
    '## OCR (golden-ocr/)',
    '',
    `Average CER: **${avgCer.toFixed(3)}** across ${ocr.length} samples`,
    '',
    '| File | Engine | CER | WER |',
    '|------|--------|-----|-----|',
    ...ocrLines,
    '',
  ].join('\n');
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

async function main() {
  const smoke = process.argv.includes('--smoke');
  logger.info({ smoke }, 'eval.start');
  const [rag, ocr] = await Promise.all([runRagSuite(smoke), runOcrSuite()]);
  const summary = {
    timestamp: new Date().toISOString(),
    smoke,
    rag: {
      count: rag.length,
      avgFaithfulness: avg(rag.map((r) => r.faithfulness)),
      avgKeywordCoverage: avg(rag.map((r) => r.keywordCoverage)),
      avgRecallAtK: avg(rag.map((r) => r.recallAtK)),
      rows: rag,
    },
    ocr: {
      count: ocr.length,
      avgCer: avg(ocr.map((o) => o.cer)),
      rows: ocr,
    },
  };

  const outDir = path.resolve(__dirname, '../../eval-output');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(outDir, `eval-${stamp}.json`), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(outDir, `eval-${stamp}.md`), renderMarkdown(rag, ocr));

  console.log(renderMarkdown(rag, ocr));

  // Fail CI if key metrics regress.
  if (!smoke) {
    if (summary.rag.avgFaithfulness < 0.6) {
      logger.error({ faith: summary.rag.avgFaithfulness }, 'eval.faithfulness.below_threshold');
      process.exit(1);
    }
  }
}

main().catch((err) => {
  logger.error({ err: err.message, stack: err.stack }, 'eval.fatal');
  process.exit(1);
});
