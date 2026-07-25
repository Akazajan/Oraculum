export interface ImportRow {
  [key: string]: string;
}

export function parseImportContent(content: string, mimetype?: string): ImportRow[] {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }

  if (mimetype?.includes('json') || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => normalizeObject(item));
      }
      if (parsed && typeof parsed === 'object') {
        return [normalizeObject(parsed)];
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
    return [];
  }

  const delimiter = detectDelimiter(lines[0]);
  const header = parseCsvLine(lines[0], delimiter).map((column) => column.trim().toLowerCase());

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line, delimiter);
    return header.reduce<ImportRow>((row, column, index) => {
      row[column] = values[index]?.trim() ?? '';
      return row;
    }, {});
  });
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
