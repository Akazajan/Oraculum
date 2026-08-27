import { parseImportContent } from './contact-import.utils';

describe('parseImportContent', () => {
  describe('with empty content', () => {
    it('returns an empty array for empty content', () => {
      expect(parseImportContent('')).toEqual([]);
    });

    it('returns an empty array for whitespace-only content', () => {
      expect(parseImportContent('   \n  \n ')).toEqual([]);
    });
  });

  describe('with valid CSV content', () => {
    it('parses rows using the first line as headers', () => {
      const content = [
        'name,email,phone',
        'Alice,alice@example.com,123-456',
        'Bob,bob@example.com,789-012',
      ].join('\n');

      expect(parseImportContent(content)).toEqual([
        { name: 'Alice', email: 'alice@example.com', phone: '123-456' },
        { name: 'Bob', email: 'bob@example.com', phone: '789-012' },
      ]);
    });

    it('lowercases headers and trims field values', () => {
      const content = 'Name, Email ,PHONE\n Alice , alice@example.com , 123 ';

      expect(parseImportContent(content)).toEqual([
        { name: 'Alice', email: 'alice@example.com', phone: '123' },
      ]);
    });

    it('detects semicolon as the delimiter when it outnumbers commas', () => {
      const content = 'name;email;phone\nAlice;alice@example.com;123';

      expect(parseImportContent(content)).toEqual([
        { name: 'Alice', email: 'alice@example.com', phone: '123' },
      ]);
    });

    it('preserves commas inside quoted fields', () => {
      const content = 'name,note\n"Doe, John","Hello, world"';

      expect(parseImportContent(content)).toEqual([
        { name: 'Doe, John', note: 'Hello, world' },
      ]);
    });

    it('unescapes doubled quotes inside quoted fields', () => {
      const content = 'name,note\n"John","Say ""hi"""';

      expect(parseImportContent(content)).toEqual([
        { name: 'John', note: 'Say "hi"' },
      ]);
    });
  });

  describe('with malformed CSV rows', () => {
    it('fills missing columns with empty strings for short rows', () => {
      const content = 'name,email,phone\nAlice,alice@example.com';

      expect(parseImportContent(content)).toEqual([
        { name: 'Alice', email: 'alice@example.com', phone: '' },
      ]);
    });

    it('ignores values that exceed the header count', () => {
      const content = 'name,email\nAlice,alice@example.com,extra,more';

      expect(parseImportContent(content)).toEqual([
        { name: 'Alice', email: 'alice@example.com' },
      ]);
    });

    it('consumes the rest of the line as one value on unbalanced quotes', () => {
      const content = 'name,email\n"Alice,alice@example.com';

      expect(parseImportContent(content)).toEqual([
        { name: 'Alice,alice@example.com', email: '' },
      ]);
    });

    it('maps a delimiter-only row to empty string fields', () => {
      const content = 'name,email\n,';

      expect(parseImportContent(content)).toEqual([{ name: '', email: '' }]);
    });

    it('skips blank and whitespace-only lines', () => {
      const content =
        'name,email\n\nAlice,alice@example.com\n   \nBob,bob@example.com\n';

      expect(parseImportContent(content)).toEqual([
        { name: 'Alice', email: 'alice@example.com' },
        { name: 'Bob', email: 'bob@example.com' },
      ]);
    });

    it('does not support multi-line quoted fields and splits them into rows', () => {
      const content = 'name,message\n"Alice","line1\nline2"';

      expect(parseImportContent(content)).toEqual([
        { name: 'Alice', message: 'line1' },
        { name: 'line2', message: '' },
      ]);
    });

    it('passes through invalid field values without throwing', () => {
      // Email/subject validation is deferred to ContactService.validateRow,
      // so the parser must stay lenient and never reject a row.
      const content = 'name,email,subject\nAlice,not-an-email,,x';

      expect(parseImportContent(content)).toEqual([
        { name: 'Alice', email: 'not-an-email', subject: '' },
      ]);
    });

    it('handles extremely long values without truncation', () => {
      const longMessage = 'x'.repeat(50_000);
      const content = `name,message\nAlice,${longMessage}`;

      expect(parseImportContent(content)).toEqual([
        { name: 'Alice', message: longMessage },
      ]);
    });

    it('falls back to CSV parsing for unparseable JSON-like input', () => {
      expect(parseImportContent('[1, 2, 3')).toEqual([]);

      expect(
        parseImportContent('{name,email\nAlice,alice@example.com'),
      ).toEqual([{ '{name': 'Alice', email: 'alice@example.com' }]);
    });

    it('falls back to CSV parsing when mimetype is json but content is not', () => {
      const content = 'name,email\nAlice,alice@example.com';

      expect(parseImportContent(content, 'application/json')).toEqual([
        { name: 'Alice', email: 'alice@example.com' },
      ]);
    });
  });

  describe('with JSON content', () => {
    it('parses a JSON array and lowercases keys', () => {
      const content = '[{"Name":"Alice","Email":"alice@example.com"}]';

      expect(parseImportContent(content)).toEqual([
        { name: 'Alice', email: 'alice@example.com' },
      ]);
    });

    it('parses a JSON object as a single row', () => {
      const content = '{"Name":"Alice","Email":"alice@example.com"}';

      expect(parseImportContent(content)).toEqual([
        { name: 'Alice', email: 'alice@example.com' },
      ]);
    });

    it('parses JSON when the mimetype indicates json', () => {
      const content = '[{"Name":"Bob"}]';

      expect(parseImportContent(content, 'application/json')).toEqual([
        { name: 'Bob' },
      ]);
    });
  });
});
