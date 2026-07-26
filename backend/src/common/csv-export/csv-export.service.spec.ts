import { CsvExportService } from './csv-export.service';

describe('CsvExportService', () => {
  let service: CsvExportService;

  beforeEach(() => {
    service = new CsvExportService();
  });

  it('generates CSV with headers and data', () => {
    const data = [
      { id: '1', name: 'Alice', amount: 100 },
      { id: '2', name: 'Bob', amount: 200 },
    ];
    const columns = [
      { key: 'id', header: 'ID' },
      { key: 'name', header: 'Name' },
      { key: 'amount', header: 'Amount' },
    ];

    const csv = service.toCsv(data, columns);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('ID,Name,Amount');
    expect(lines[1]).toBe('1,Alice,100');
    expect(lines[2]).toBe('2,Bob,200');
  });

  it('returns only headers for empty data', () => {
    const columns = [
      { key: 'id', header: 'ID' },
      { key: 'name', header: 'Name' },
    ];

    const csv = service.toCsv([], columns);
    expect(csv.trim()).toBe('ID,Name');
  });

  it('escapes fields containing commas', () => {
    const data = [{ name: 'Doe, John' }];
    const columns = [{ key: 'name', header: 'Name' }];

    const csv = service.toCsv(data, columns);
    expect(csv).toContain('"Doe, John"');
  });

  it('escapes fields containing quotes', () => {
    const data = [{ name: 'Say "hello"' }];
    const columns = [{ key: 'name', header: 'Name' }];

    const csv = service.toCsv(data, columns);
    expect(csv).toContain('"Say ""hello"""');
  });

  it('handles null and undefined values', () => {
    const data = [{ name: null, value: undefined }];
    const columns = [
      { key: 'name', header: 'Name' },
      { key: 'value', header: 'Value' },
    ];

    const csv = service.toCsv(data, columns);
    const lines = csv.trim().split('\n');
    expect(lines[1]).toBe(',');
  });

  it('formats Date objects as ISO strings', () => {
    const date = new Date('2026-01-15T10:00:00.000Z');
    const data = [{ createdAt: date }];
    const columns = [{ key: 'createdAt', header: 'Created' }];

    const csv = service.toCsv(data, columns);
    expect(csv).toContain('2026-01-15T10:00:00.000Z');
  });
});
