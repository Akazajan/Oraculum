import { Injectable } from '@nestjs/common';
import { Readable } from 'stream';

@Injectable()
export class CsvExportService {
  /**
   * Convert an array of objects to a CSV string with proper headers.
   */
  toCsv(data: Record<string, unknown>[], columns: Array<{ key: string; header: string }>): string {
    if (data.length === 0) {
      return columns.map((c) => c.header).join(',') + '\n';
    }

    const header = columns.map((c) => this.escapeField(c.header)).join(',');
    const rows = data.map((row) =>
      columns
        .map((col) => {
          const value = row[col.key];
          return this.escapeField(this.formatValue(value));
        })
        .join(','),
    );

    return header + '\n' + rows.join('\n') + '\n';
  }

  /**
   * Stream large datasets as CSV for memory efficiency.
   * Uses a generator to yield CSV chunks.
   */
  async *toCsvStream(
    dataIterator: AsyncIterable<Record<string, unknown>>,
    columns: Array<{ key: string; header: string }>,
  ): AsyncGenerator<string, void, unknown> {
    yield columns.map((c) => c.header).join(',') + '\n';

    for await (const row of dataIterator) {
      yield columns
        .map((col) => {
          const value = row[col.key];
          return this.escapeField(this.formatValue(value));
        })
        .join(',') + '\n';
    }
  }

  private escapeField(value: string): string {
    // Neutralise spreadsheet formula injection: prefix dangerous leading
    // characters with a single-quote so the cell is treated as plain text.
    const sanitized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

    if (
      sanitized.includes(',') ||
      sanitized.includes('"') ||
      sanitized.includes('\n')
    ) {
      return `"${sanitized.replace(/"/g, '""')}"`;
    }
    return sanitized;
  }

  private formatValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
}
