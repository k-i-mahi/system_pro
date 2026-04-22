import * as XLSX from 'xlsx';

export interface ParsedMarkRow {
  row: number;
  rollNumber: string;
  ctScore1?: number;
  ctScore2?: number;
  ctScore3?: number;
  labScore?: number;
}

export interface ParseError {
  row: number;
  rollNumber?: string;
  reason: string;
}

export interface ParseResult {
  records: ParsedMarkRow[];
  errors: ParseError[];
}

const ROLL_COLUMN_NAMES = ['rollnumber', 'roll_number', 'roll', 'studentid', 'student_id', 'id'];
const SCORE_COLUMNS: Record<string, keyof Pick<ParsedMarkRow, 'ctScore1' | 'ctScore2' | 'ctScore3' | 'labScore'>> = {
  ct1: 'ctScore1',
  ctscore1: 'ctScore1',
  ct_score_1: 'ctScore1',
  ct2: 'ctScore2',
  ctscore2: 'ctScore2',
  ct_score_2: 'ctScore2',
  ct3: 'ctScore3',
  ctscore3: 'ctScore3',
  ct_score_3: 'ctScore3',
  lab: 'labScore',
  labscore: 'labScore',
  lab_score: 'labScore',
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s\-]+/g, '_');
}

export function parseSpreadsheet(buffer: Buffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { records: [], errors: [{ row: 0, reason: 'Spreadsheet has no sheets' }] };
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });

  if (rows.length === 0) {
    return { records: [], errors: [{ row: 0, reason: 'Spreadsheet is empty' }] };
  }

  // Map headers
  const rawHeaders = Object.keys(rows[0]);
  const headerMap: Record<string, string> = {};
  for (const h of rawHeaders) {
    headerMap[normalizeHeader(h)] = h;
  }

  // Find roll number column
  const rollKey = ROLL_COLUMN_NAMES.find((name) => headerMap[name]);
  if (!rollKey) {
    return { records: [], errors: [{ row: 0, reason: 'No roll number column found. Expected one of: rollNumber, roll, studentId' }] };
  }
  const rollHeader = headerMap[rollKey];

  // Find score columns
  const scoreMapping: { original: string; field: keyof Pick<ParsedMarkRow, 'ctScore1' | 'ctScore2' | 'ctScore3' | 'labScore'> }[] = [];
  for (const [normalized, original] of Object.entries(headerMap)) {
    if (SCORE_COLUMNS[normalized]) {
      scoreMapping.push({ original, field: SCORE_COLUMNS[normalized] });
    }
  }

  if (scoreMapping.length === 0) {
    return { records: [], errors: [{ row: 0, reason: 'No score columns found. Expected columns like: CT1, CT2, CT3, Lab' }] };
  }

  const records: ParsedMarkRow[] = [];
  const errors: ParseError[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const rowData = rows[i];
    const rowNum = i + 2; // 1-indexed + header row
    const rollValue = String(rowData[rollHeader]).trim();

    if (!rollValue) {
      errors.push({ row: rowNum, reason: 'Missing roll number' });
      continue;
    }

    if (seen.has(rollValue)) {
      errors.push({ row: rowNum, rollNumber: rollValue, reason: 'Duplicate roll number (later entry used)' });
      // Remove previous entry so the later one takes precedence
      const prevIdx = records.findIndex((r) => r.rollNumber === rollValue);
      if (prevIdx !== -1) records.splice(prevIdx, 1);
    }
    seen.add(rollValue);

    const record: ParsedMarkRow = { row: rowNum, rollNumber: rollValue };
    let hasValidScore = false;

    for (const { original, field } of scoreMapping) {
      const raw = rowData[original];
      if (raw === '' || raw === null || raw === undefined) continue;
      const num = Number(raw);
      if (isNaN(num) || num < 0) {
        errors.push({ row: rowNum, rollNumber: rollValue, reason: `Invalid value for ${original}: "${raw}"` });
        continue;
      }
      record[field] = num;
      hasValidScore = true;
    }

    if (hasValidScore) {
      records.push(record);
    } else {
      errors.push({ row: rowNum, rollNumber: rollValue, reason: 'No valid score values found' });
    }
  }

  return { records, errors };
}
