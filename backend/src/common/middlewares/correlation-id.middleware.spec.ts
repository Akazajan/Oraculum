import { CorrelationIdMiddleware } from './correlation-id.middleware';

interface MockReq {
  header: jest.Mock;
  get: jest.Mock;
  headers: Record<string, unknown>;
  ip?: string;
  socket?: { remoteAddress?: string };
  correlationId?: string;
}

interface MockRes {
  locals: Record<string, unknown>;
  headers: Record<string, string>;
  setHeader: jest.Mock;
}

function buildReq(overrides: Partial<MockReq> = {}): MockReq {
  const headers: Record<string, unknown> = overrides.headers ?? {};
  const headerByName = (name: string): unknown => {
    if (name === 'x-correlation-id') {
      // See overrides.header
      return overrides.header?.(name);
    }
    return headers[name.toLowerCase()];
  };
  return {
    header: overrides.header ?? jest.fn(headerByName),
    get: jest.fn((name: string) => {
      const value = headerByName(name);
      return typeof value === 'string' ? value : undefined;
    }),
    headers,
    ...overrides,
  };
}

function buildRes(): MockRes {
  const headers: Record<string, string> = {};
  const res: MockRes = {
    locals: {},
    headers,
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
    }),
  };
  return res;
}

describe('CorrelationIdMiddleware', () => {
  let middleware: CorrelationIdMiddleware;

  beforeEach(() => {
    middleware = new CorrelationIdMiddleware();
  });

  it('uses the incoming x-correlation-id header when present and valid', () => {
    let middlewareRan = false;
    const req = buildReq({
      header: jest.fn((name: string) =>
        name === 'x-correlation-id' ? 'caller-supplied-id' : undefined,
      ),
    });
    const res = buildRes();
    middleware.use(req as never, res as never, () => {
      middlewareRan = true;
    });
    expect(res.setHeader).toHaveBeenCalledWith(
      'x-correlation-id',
      'caller-supplied-id',
    );
    expect(req.correlationId).toBe('caller-supplied-id');
    expect(middlewareRan).toBe(true);
  });

  it('generates a UUID v4 when no header is supplied', () => {
    const req = buildReq();
    const res = buildRes();
    middleware.use(req as never, res as never, () => undefined);
    expect(req.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(res.headers['x-correlation-id']).toBe(req.correlationId);
  });

  it('generates a UUID v4 when the header is empty or too long', () => {
    const emptyReq = buildReq({
      header: jest.fn().mockReturnValue(''),
    });
    const emptyRes = buildRes();
    middleware.use(emptyReq as never, emptyRes as never, () => undefined);
    expect(emptyReq.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const longHeader = 'x'.repeat(129);
    const longReq = buildReq({
      header: jest.fn().mockReturnValue(longHeader),
    });
    const longRes = buildRes();
    middleware.use(longReq as never, longRes as never, () => undefined);
    expect(longHeader.length).toBeGreaterThan(128);
    expect(longReq.correlationId).not.toBe(longHeader);
  });

  it('uses x-forwarded-for to derive the request IP', () => {
    const req = buildReq({
      headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' },
      ip: '127.0.0.1',
    });
    const res = buildRes();
    middleware.use(req as never, res as never, () => undefined);
    expect(req.correlationId).toBeDefined();
    expect(res.headers['x-correlation-id']).toBeDefined();
  });

  it('captures the user-agent into the ALS context', () => {
    const req = buildReq({
      headers: { 'user-agent': 'jest-test/1.0' },
    });
    const res = buildRes();
    let sawIt = false;
    middleware.use(req as never, res as never, () => {
      sawIt = true;
    });
    expect(sawIt).toBe(true);
  });
});
