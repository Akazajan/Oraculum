import { getCurrentActorFromAls } from './current-actor.util';
import { runWithRequestContext } from '../context/correlation-context';

const baseStore = {
  correlationId: 'corr-123',
  request: { ip: '127.0.0.1', userAgent: 'jest' },
};

describe('getCurrentActorFromAls', () => {
  it('returns null fields when called outside any ALS context', () => {
    expect(getCurrentActorFromAls()).toEqual({
      id: null,
      email: null,
      role: null,
    });
  });

  it('returns null fields when the ALS context has no user', () => {
    const result = runWithRequestContext(baseStore, () =>
      getCurrentActorFromAls(),
    );

    expect(result).toEqual({ id: null, email: null, role: null });
  });

  it('returns the actor from the ALS user when present', () => {
    const result = runWithRequestContext(
      {
        ...baseStore,
        user: { id: 'user-1', email: 'admin@example.com', role: 'ADMIN' },
      },
      () => getCurrentActorFromAls(),
    );

    expect(result).toEqual({
      id: 'user-1',
      email: 'admin@example.com',
      role: 'ADMIN',
    });
  });

  it('nulls out fields missing from a partial ALS user', () => {
    const result = runWithRequestContext(
      { ...baseStore, user: { id: 'user-2' } },
      () => getCurrentActorFromAls(),
    );

    expect(result).toEqual({ id: 'user-2', email: null, role: null });
  });
});
