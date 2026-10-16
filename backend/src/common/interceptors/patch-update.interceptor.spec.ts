import { PatchUpdateInterceptor } from './patch-update.interceptor';

describe('PatchUpdateInterceptor', () => {
  let interceptor: PatchUpdateInterceptor;

  beforeEach(() => {
    interceptor = new PatchUpdateInterceptor();
  });

  it('strips undefined fields from PATCH request bodies before delegation', () => {
    const request = {
      method: 'PATCH',
      body: {
        name: 'Updated name',
        description: undefined,
        enabled: false,
        clearedAt: null,
      },
    };
    const next = { handle: jest.fn() };

    interceptor.intercept(
      { switchToHttp: () => ({ getRequest: () => request }) } as never,
      next,
    );

    expect(request.body).toEqual({
      name: 'Updated name',
      enabled: false,
      clearedAt: null,
    });
    expect(next.handle).toHaveBeenCalledTimes(1);
  });

  it('preserves a PATCH body without undefined fields and returns the handler result', () => {
    const body = { name: 'Updated name', enabled: true };
    const request = { method: 'PATCH', body };
    const result = {};
    const next = { handle: jest.fn().mockReturnValue(result) };

    const output = interceptor.intercept(
      { switchToHttp: () => ({ getRequest: () => request }) } as never,
      next,
    );

    expect(request.body).toEqual(body);
    expect(output).toBe(result);
    expect(next.handle).toHaveBeenCalledTimes(1);
  });
});
