import {
  ApiVersionMiddleware,
  CURRENT_API_VERSION,
  DEPRECATED_API_VERSIONS,
  SUNSET_DATE,
  SUPPORTED_API_VERSIONS,
} from './api-version.middleware';

describe('ApiVersionMiddleware', () => {
  let middleware: ApiVersionMiddleware;
  let req: any;
  let res: any;
  let nextFn: jest.Mock;

  beforeEach(() => {
    middleware = new ApiVersionMiddleware();
    req = { params: {} };
    res = { setHeader: jest.fn() };
    nextFn = jest.fn();
  });

  it('sets X-API-Version header from route param', () => {
    req.params.version = '1';
    middleware.use(req, res, nextFn);
    expect(res.setHeader).toHaveBeenCalledWith('X-API-Version', '1');
    expect(nextFn).toHaveBeenCalled();
  });

  it('falls back to CURRENT_API_VERSION when no version param', () => {
    middleware.use(req, res, nextFn);
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-API-Version',
      CURRENT_API_VERSION,
    );
  });

  it('sets X-API-Versions-Supported header', () => {
    middleware.use(req, res, nextFn);
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-API-Versions-Supported',
      SUPPORTED_API_VERSIONS.join(', '),
    );
  });

  it('does not set Deprecation header for non-deprecated version', () => {
    req.params.version = '1';
    middleware.use(req, res, nextFn);
    const headerNames = res.setHeader.mock.calls.map((c: any[]) => c[0]);
    expect(headerNames).not.toContain('Deprecation');
    expect(headerNames).not.toContain('Sunset');
  });

  it('sets deprecation headers for a deprecated version', () => {
    const deprecatedVersion = '0';
    DEPRECATED_API_VERSIONS.push(deprecatedVersion);
    req.params.version = deprecatedVersion;

    try {
      middleware.use(req, res, nextFn);

      expect(res.setHeader).toHaveBeenCalledWith('Deprecation', 'true');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Sunset',
        new Date(SUNSET_DATE).toUTCString(),
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-API-Warn',
        `Version ${deprecatedVersion} is deprecated. Migrate to v${CURRENT_API_VERSION} before ${SUNSET_DATE}.`,
      );
      expect(nextFn).toHaveBeenCalled();
    } finally {
      DEPRECATED_API_VERSIONS.splice(
        DEPRECATED_API_VERSIONS.indexOf(deprecatedVersion),
        1,
      );
    }
  });
});
