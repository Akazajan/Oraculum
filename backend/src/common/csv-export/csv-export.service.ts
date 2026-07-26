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
  *toCsvStream(
    dataIterator: AsyncIterable<Record<string, unknown>>,
    columns: Array<{ key: string; header: string }>,
  ): Generator<string, void, unknown> {
    yield columns.map((c) => c.header).join(',') + '\n';

    for (const row of dataIterator) {
      yield columns
        .map((col) => {
          const value = row[col.key];
          return this.escapeField(this.formatValue(value));
        })
        .join(',') + '\n';
    }
  }

  private escapeField(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private formatValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
}
