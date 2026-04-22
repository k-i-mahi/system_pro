import Tesseract from 'tesseract.js';
import fs from 'fs';
import path from 'path';
// pdf-parse ships as CJS with no type declarations; cast at call site.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string; numpages: number }>;
import mammoth from 'mammoth';
import { request } from 'undici';
import { env } from '../config/env.js';
import { logger } from './observability/logger.js';
import { ocrJobDuration } from './observability/metrics.js';

// Handles common formats like CSE3200, CSE-3200, CSE 3200, EEE-2101A.
const COURSE_CODE_REGEX = /[A-Z]{2,6}[\s-]?\d{3,4}[A-Z]?/g;

function normalizePrefix(prefix: string): string {
  return prefix
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/5/g, 'S')
    .replace(/8/g, 'B')
    .replace(/2/g, 'Z');
}

function normalizeNumberPart(num: string): string {
  return num
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/G/g, '6')
    .replace(/Z/g, '2');
}

function maybeComposeCode(prefixRaw: string, numberRaw: string): string | null {
  const prefix = normalizePrefix(prefixRaw.replace(/[^A-Z0-9]/g, ''));
  const number = normalizeNumberPart(numberRaw.replace(/[^A-Z0-9]/g, ''));
  if (!/^[A-Z]{2,6}$/.test(prefix)) return null;
  if (!/^\d{3,4}[A-Z]?$/.test(number)) return null;
  return `${prefix}${number}`;
}

export type OcrQuality = 'fast' | 'accurate';

export interface OcrResult {
  text: string;
  codes: string[];
  /** Per-page text when the source is paginated (PDF). */
  pages?: string[];
  /** Engine that produced the text — recorded for observability. */
  engine: 'tesseract' | 'pdf-parse' | 'mammoth' | 'trocr' | 'nougat' | 'unstructured';
}

function extractCodes(text: string): string[] {
  // Normalize to uppercase and remove OCR punctuation noise around tokens.
  const normalized = text
    .toUpperCase()
    .replace(/[|]/g, 'I')
    .replace(/[—–]/g, '-')
    .replace(/[\u2018\u2019\u201C\u201D]/g, ' ');

  const candidates = new Set<string>();

  // 1) Direct regex extraction from normalized OCR text.
  const rawMatches = normalized.match(COURSE_CODE_REGEX) || [];
  for (const m of rawMatches) {
    const compact = m.replace(/\s|-/g, '');
    const parts = compact.match(/^([A-Z0-9]{2,6})([A-Z0-9]{3,5})$/);
    if (!parts) continue;
    const composed = maybeComposeCode(parts[1], parts[2]);
    if (composed) candidates.add(composed);
  }

  // 2) Fallback token parsing for OCR that splits prefix and number in separate tokens.
  const tokens = normalized
    .split(/[^A-Z0-9-]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].replace(/-/g, '');

    // Single-token pattern, e.g. C5E3200, EEE2I01.
    const single = tok.match(/^([A-Z0-9]{2,6})([A-Z0-9]{3,5})$/);
    if (single) {
      const composed = maybeComposeCode(single[1], single[2]);
      if (composed) candidates.add(composed);
    }

    // Two-token pattern, e.g. CSE 3200 or EEE 2101A.
    if (i + 1 < tokens.length) {
      const composed = maybeComposeCode(tok, tokens[i + 1]);
      if (composed) candidates.add(composed);
    }
  }

  return [...candidates];
}

async function runTesseract(imagePath: string): Promise<string> {
  const {
    data: { text },
  } = await Tesseract.recognize(imagePath, 'eng');
  return text;
}

export async function extractTextFromImage(
  imagePath: string,
  quality: OcrQuality = 'fast'
): Promise<OcrResult> {
  if (quality === 'accurate') {
    try {
      const text = await sidecarHandwriting(imagePath);
      return { text, codes: extractCodes(text), engine: 'trocr' };
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'sidecar handwriting failed, falling back to Tesseract');
    }
  }
  const text = await runTesseract(imagePath);
  return { text, codes: extractCodes(text), engine: 'tesseract' };
}

async function extractTextFromPdf(
  filePath: string,
  quality: OcrQuality
): Promise<OcrResult> {
  if (quality === 'accurate') {
    try {
      const { text, pages } = await sidecarAcademicPdf(filePath);
      return { text, pages, codes: extractCodes(text), engine: 'nougat' };
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'sidecar nougat failed, falling back to pdf-parse');
    }
  }

  const buffer = fs.readFileSync(filePath);
  const { text } = await pdfParse(buffer);
  return { text, codes: extractCodes(text), engine: 'pdf-parse' };
}

async function extractTextFromDocx(filePath: string): Promise<OcrResult> {
  const buffer = fs.readFileSync(filePath);
  const { value: text } = await mammoth.extractRawText({ buffer });
  return { text, codes: extractCodes(text), engine: 'mammoth' };
}

export async function extractTextFromFile(
  filePath: string,
  quality: OcrQuality = 'fast'
): Promise<OcrResult> {
  const started = process.hrtime.bigint();
  const ext = path.extname(filePath).toLowerCase();
  let result: OcrResult;
  let status: 'ok' | 'error' = 'ok';

  try {
    switch (ext) {
      case '.pdf':
        result = await extractTextFromPdf(filePath, quality);
        break;
      case '.docx':
        result = await extractTextFromDocx(filePath);
        break;
      case '.doc':
        throw new Error('Legacy .doc format is not supported. Please convert to .docx and try again.');
      default:
        result = await extractTextFromImage(filePath, quality);
    }
    return result;
  } catch (err) {
    status = 'error';
    throw err;
  } finally {
    const durSec = Number((process.hrtime.bigint() - started) / 1_000_000n) / 1000;
    ocrJobDuration.observe(
      { quality, engine: 'multi', status },
      durSec
    );
  }
}

/**
 * POST an image to the Python sidecar's TrOCR handwriting endpoint.
 * Returns plain-text transcription.
 */
async function sidecarHandwriting(imagePath: string): Promise<string> {
  const buffer = fs.readFileSync(imagePath);
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)]), path.basename(imagePath));

  const { statusCode, body } = await request(`${env.AI_SIDECAR_URL}/ocr/handwriting`, {
    method: 'POST',
    body: form,
    headersTimeout: 60_000,
    bodyTimeout: 90_000,
  });
  if (statusCode >= 400) {
    throw new Error(`ai-sidecar handwriting ${statusCode}`);
  }
  const json = (await body.json()) as { text: string };
  return json.text ?? '';
}

/**
 * POST a PDF to the sidecar's Nougat endpoint — yields markdown+LaTeX text
 * plus per-page split for citation granularity.
 */
async function sidecarAcademicPdf(
  filePath: string
): Promise<{ text: string; pages: string[] }> {
  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }), path.basename(filePath));

  const { statusCode, body } = await request(`${env.AI_SIDECAR_URL}/ocr/academic-pdf`, {
    method: 'POST',
    body: form,
    headersTimeout: 120_000,
    bodyTimeout: 600_000,
  });
  if (statusCode >= 400) {
    throw new Error(`ai-sidecar nougat ${statusCode}`);
  }
  const json = (await body.json()) as { text: string; pages?: string[] };
  return {
    text: json.text ?? '',
    pages: Array.isArray(json.pages) ? json.pages : (json.text ?? '').split(/\f+/),
  };
}
