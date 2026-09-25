export interface ImportRow {
  [key: string]: string;
}

export interface ImportError {
  row: number;
  message: string;
  data?: string;
}

export interface ImportValidationResult {
  validRows: ImportRow[];
  errors: ImportError[];
}

/**
 * Parses import content with validation
 * @param content The content to parse
 * @param mimetype Optional MIME type of the content
 * @returns Object containing valid rows and validation errors
 */
export function parseImportContent(content: string, mimetype?: string): ImportRow[] {
  const result = parseImportContentWithValidation(content, mimetype);
  return result.validRows;
}

/**
 * Parses import content with validation
 * @param content The content to parse
 * @param mimetype Optional MIME type of the content
 * @returns Object containing valid rows and validation errors
 */
export function parseImportContentWithValidation(content: string, mimetype?: string): ImportValidationResult {
  const trimmed = content.trim();
  if (!trimmed) {
    return { validRows: [], errors: [] };
  }

  if (mimetype?.includes('json') || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const rows = parsed.map((item) => normalizeObject(item));
        const { validRows, errors } = validateImportRows(rows);
        return { validRows, errors };
      }
      if (parsed && typeof parsed === 'object') {
        const row = normalizeObject(parsed);
        const { validRows, errors } = validateImportRows([row]);
        return { validRows, errors };
      }
    } catch {
      // fall back to CSV/text parsing below
    }
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { validRows: [], errors: [] };
  }

  const delimiter = detectDelimiter(lines[0]);
  const header = parseCsvLine(lines[0], delimiter).map((column) => column.trim().toLowerCase());

  const validRows: ImportRow[] = [];
  const errors: ImportError[] = [];
  
  lines.slice(1).forEach((line, index) => {
    const rowNumber = index + 2; // +1 for 0-based index, +1 for header row
    
    try {
      const values = parseCsvLine(line, delimiter);
      const row = header.reduce<ImportRow>((row, column, colIndex) => {
        row[column] = values[colIndex]?.trim() ?? '';
        return row;
      }, {});
      
      // Validate the row
      const validationError = validateImportRow(row, rowNumber);
      if (validationError) {
        errors.push({
          row: rowNumber,
          message: validationError.message,
          data: line
        });
      } else {
        validRows.push(row);
      }
    } catch (error) {
      errors.push({
        row: rowNumber,
        message: error instanceof Error ? error.message : 'Invalid CSV format',
        data: line
      });
    }
  });
  
  return { validRows, errors };
}

/**
 * Validates multiple import rows
 * @param rows The rows to validate
 * @returns Object containing valid rows and validation errors
 */
function validateImportRows(rows: ImportRow[]): ImportValidationResult {
  const validRows: ImportRow[] = [];
  const errors: ImportError[] = [];
  
  rows.forEach((row, index) => {
    const rowNumber = index + 1; // 1-based index
    
    const validationError = validateImportRow(row, rowNumber);
    if (validationError) {
      errors.push({
        row: rowNumber,
        message: validationError.message
      });
    } else {
      validRows.push(row);
    }
  });
  
  return { validRows, errors };
}

/**
 * Validates an import row for required fields and email format
 * @param row The row to validate
 * @param rowNumber The row number for error reporting
 * @returns Error message if validation fails, otherwise null
 */
function validateImportRow(row: ImportRow, rowNumber: number): { message: string } | null {
  // Check for required fields (assuming email is required)
  if (!row.email || !row.email.trim()) {
    return { 
      message: `Missing required field: email at row ${rowNumber}` 
    };
  }
  
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(row.email)) {
    return { 
      message: `Invalid email format: ${row.email} at row ${rowNumber}` 
    };
  }
  
  return null;
}

function normalizeObject(value: unknown): ImportRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.entries(value as Record<string, unknown>).reduce<ImportRow>((row, [key, entryValue]) => {
    row[key.toLowerCase()] = typeof entryValue === 'string' ? entryValue : String(entryValue ?? '');
    return row;
  }, {});
}

function detectDelimiter(header: string): ',' | ';' {
  const commaCount = (header.match(/,/g) ?? []).length;
  const semicolonCount = (header.match(/;/g) ?? []).length;
  return semicolonCount > commaCount ? ';' : ',';
}

function parseCsvLine(line: string, delimiter: ',' | ';'): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}
