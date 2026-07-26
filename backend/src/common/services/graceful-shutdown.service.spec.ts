import { GracefulShutdownService } from './graceful-shutdown.service';

describe('GracefulShutdownService', () => {
  let service: GracefulShutdownService;

  beforeEach(() => {
    service = new GracefulShutdownService({} as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should register signal handlers', () => {
    const onSpy = jest.spyOn(process, 'on');
    service.registerSignalHandlers();
    expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    onSpy.mockRestore();
  });

  it('should set http server', () => {
    const mockServer = { close: jest.fn() } as any;
    service.setHttpServer(mockServer);
    // @ts-ignore
    expect(service.httpServer).toBe(mockServer);
  });

  it('should drain http server on destroy', async () => {
    const closeMock = jest.fn((cb: Function) => cb(null));
    service.setHttpServer({ close: closeMock } as any);
    await service.onModuleDestroy();
    expect(closeMock).toHaveBeenCalled();
  });

  it('should handle http server drain error gracefully', async () => {
    const closeMock = jest.fn((cb: Function) => cb(new Error('drain failed')));
    service.setHttpServer({ close: closeMock } as any);
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('should handle missing http server', async () => {
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('should not run shutdown twice', async () => {
    service.setHttpServer({ close: jest.fn((cb: Function) => cb(null)) } as any);
    await service.onModuleDestroy();
    const closeSpy = jest.fn((cb: Function) => cb(null));
    service.setHttpServer({ close: closeSpy } as any);
    await service.onModuleDestroy();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('should respect SHUTDOWN_TIMEOUT_MS env var', () => {
    const original = process.env.SHUTDOWN_TIMEOUT_MS;
    process.env.SHUTDOWN_TIMEOUT_MS = '5000';
    const svc = new GracefulShutdownService({} as any);
    // @ts-ignore
    expect(svc.forceShutdownTimeoutMs).toBe(5000);
    process.env.SHUTDOWN_TIMEOUT_MS = original;
  });
});
