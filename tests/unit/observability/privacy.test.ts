import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  AppError,
  appErrorDetails,
  type AppErrorCode,
} from '../../../src/modules/observability/domain/app-error';
import {
  createCorrelationId,
  type CorrelationId,
} from '../../../src/modules/observability/domain/correlation-id';
import {
  logError,
  redactLogContext,
  type OperationalLogger,
} from '../../../src/modules/observability/application/log-error';
import { FakeAnalyticsProvider } from '../../../src/infrastructure/analytics/fake-analytics-provider';
import { serializeAnalyticsEvent } from '../../../src/infrastructure/analytics/analytics-provider';

const organizationId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const unsafeValues = [
  'private@example.com',
  '+1 555 555 5555',
  'score_98',
  'private evaluator notes',
  'sk_private',
  'bearer-secret-token',
  'toString',
  'constructor',
] as const;

describe('privacy-safe observability', () => {
  it('derives every category and serialized field from a closed application-error code', () => {
    const cases = [
      ['validation_failed', 'validation'],
      ['permission_denied', 'permission'],
      ['conflict_detected', 'conflict'],
      ['network_unavailable', 'network'],
      ['integration_unavailable', 'integration'],
      ['unexpected_error', 'unexpected'],
    ] as const;

    expect(cases.map(([code]) => new AppError(code).toJSON())).toEqual(
      cases.map(([code, category]) => ({ category, code })),
    );
  });

  it('normalizes direct casts and object-shaped constructor bypasses without serializing values', () => {
    for (const value of unsafeValues) {
      const cast = new AppError(value as AppErrorCode);
      const object = new AppError({ code: value, message: value, cause: value } as never);

      expect(cast.toJSON()).toEqual({ category: 'unexpected', code: 'unexpected_error' });
      expect(object.toJSON()).toEqual({ category: 'unexpected', code: 'unexpected_error' });
      expect(JSON.stringify([cast, object])).not.toContain(value);
      expect(cast.message).toBe('An unexpected error occurred.');
      expect(object.message).toBe('An unexpected error occurred.');
    }
  });

  it('normalizes prototype-forged application errors before logging or serialization', () => {
    const forged = Object.assign(Object.create(AppError.prototype) as object, {
      category: 'integration',
      code: 'sk_private',
      message: 'private@example.com score_98',
    }) as AppError;
    const records: unknown[] = [];

    expect(AppError.prototype.toJSON.call(forged)).toEqual({
      category: 'unexpected',
      code: 'unexpected_error',
    });
    logError({ error: (record) => records.push(record) }, forged);
    expect(records).toEqual([
      {
        category: 'unexpected',
        code: 'unexpected_error',
        context: {},
        level: 'error',
      },
    ]);
    expect(JSON.stringify([forged, records])).not.toMatch(
      /sk_private|private@example\.com|score_98/u,
    );
  });

  it('snapshots a mutable application-error code once before deriving closed output', () => {
    for (const inheritedName of ['toString', 'constructor'] as const) {
      const error = new AppError('integration_unavailable');
      let reads = 0;
      Object.defineProperty(error, 'code', {
        configurable: true,
        get: () => (reads++ === 0 ? 'integration_unavailable' : inheritedName),
      });

      expect(appErrorDetails(error)).toEqual({
        category: 'integration',
        code: 'integration_unavailable',
      });
      expect(reads).toBe(1);
    }
  });

  it('turns throwing, proxied, inherited, and non-record application errors into closed output', () => {
    const throwing = new AppError('integration_unavailable');
    Object.defineProperty(throwing, 'code', {
      configurable: true,
      get: () => {
        throw new Error('sk_private private@example.com score_98');
      },
    });
    let proxyReads = 0;
    const proxied = new Proxy(new AppError('integration_unavailable'), {
      get: (_target, key) =>
        key === 'code'
          ? ['integration_unavailable', 'toString'][proxyReads++]
          : Reflect.get(_target, key),
    });
    const inherited = Object.create(
      Object.assign(Object.create(AppError.prototype) as object, { code: 'constructor' }),
    ) as AppError;

    for (const value of [throwing, proxied, inherited, [], () => 'sk_private']) {
      let details: ReturnType<typeof appErrorDetails> | undefined;
      expect(() => {
        details = appErrorDetails(value);
      }).not.toThrow();
      expect(details).toEqual({
        category: 'unexpected',
        code: 'unexpected_error',
      });
      expect(JSON.stringify(AppError.prototype.toJSON.call(value))).not.toMatch(
        /sk_private|private@example\.com|score_98|toString|constructor/u,
      );
    }
  });

  it('accepts only authentically generated correlation IDs and closed operation values', () => {
    const correlationId = createCorrelationId();
    const requestId = createCorrelationId();
    const safe = redactLogContext({
      organizationId,
      actorId,
      requestId,
      correlationId,
      operation: 'health.read',
      score: 9.8,
      notes: 'private evaluator note',
      guardianEmail: 'private@example.com',
      guardianPhone: '+1 555 555 5555',
      providerSecret: 'sk_private',
      accessToken: 'bearer-secret',
      rawPayload: { athleteName: 'Private Athlete' },
    });

    expect(safe).toEqual({
      actorId,
      correlationId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      ),
      operation: 'health.read',
      organizationId,
      requestId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      ),
    });
    expect(safe.correlationId).not.toBe(safe.requestId);
  });

  it('drops raw strings, forged branded objects, and sensitive values from every log field', () => {
    const forged = Object.freeze({ value: '11111111-1111-4111-8111-111111111111' });
    for (const value of unsafeValues) {
      expect(
        redactLogContext({
          actorId: value,
          organizationId: value,
          jobId: value,
          requestId: value,
          correlationId: value,
          operation: value,
          code: value,
        }),
      ).toEqual({});
    }
    expect(
      redactLogContext({
        correlationId: forged as unknown as CorrelationId,
        requestId: '11111111-1111-4111-8111-111111111111' as never,
        operation: 'sk_private' as never,
      }),
    ).toEqual({});
  });

  it('reads each log accessor once and never emits a later secret value', () => {
    let operationReads = 0;
    const alternating = Object.defineProperty({}, 'operation', {
      enumerable: true,
      get: () => ['health.read', 'health.read', 'sk_private'][operationReads++],
    });

    expect(redactLogContext(alternating)).toEqual({ operation: 'health.read' });
    expect(operationReads).toBe(1);

    let proxyReads = 0;
    const proxied = new Proxy(
      { operation: 'health.read' },
      {
        get: (target, key) =>
          key === 'operation'
            ? ['health.read', 'health.read', 'sk_private'][proxyReads++]
            : Reflect.get(target, key),
      },
    );
    expect(redactLogContext(proxied)).toEqual({ operation: 'health.read' });
    expect(proxyReads).toBe(1);

    const throwing = Object.defineProperty({}, 'actorId', {
      enumerable: true,
      get: () => {
        throw new Error('sk_private private@example.com score_98');
      },
    });
    expect(() => redactLogContext(throwing)).not.toThrow();
    expect(redactLogContext(throwing)).toEqual({});
  });

  it('ignores inherited, symbol, array, and function log metadata containers', () => {
    const inherited = Object.create({ operation: 'health.read' }) as Record<string, unknown>;
    Object.defineProperty(inherited, Symbol('sk_private'), {
      enumerable: true,
      value: 'private@example.com',
    });
    const array = Object.assign([], { operation: 'health.read' });
    const callable = Object.assign(() => undefined, { operation: 'health.read' });

    expect(redactLogContext(inherited)).toEqual({});
    expect(redactLogContext(array as never)).toEqual({});
    expect(redactLogContext(callable as never)).toEqual({});
  });

  it('logs only closed errors and allow-listed safe context values', () => {
    const records: unknown[] = [];
    const logger: OperationalLogger = { error: (record) => records.push(record) };

    logError(logger, new Error('guardian private@example.com token sk_private'), {
      organizationId,
      actorId,
      correlationId: 'sk_private' as never,
      operation: 'score_98' as never,
      notes: 'private evaluator note',
    });

    expect(records).toEqual([
      {
        category: 'unexpected',
        code: 'unexpected_error',
        context: { actorId, organizationId },
        level: 'error',
      },
    ]);
    expect(JSON.stringify(records)).not.toMatch(/private@example\.com|sk_private|score_98|notes?/u);
  });

  it('does not swallow a trusted logger failure after safe record construction', () => {
    const outputFailure = new Error('trusted logger programming failure');

    expect(() =>
      logError(
        {
          error: () => {
            throw outputFailure;
          },
        },
        new AppError('integration_unavailable'),
        { operation: 'health.read' },
      ),
    ).toThrow(outputFailure);
  });

  it('rejects sensitive values and runtime casts in every analytics field', async () => {
    const provider = new FakeAnalyticsProvider();
    const base = {
      name: 'workflow.completed',
      workflow: 'evaluation_sync',
      organizationId,
      correlationId: createCorrelationId(),
    } as const;

    for (const field of ['name', 'workflow', 'organizationId', 'correlationId'] as const) {
      for (const value of unsafeValues) {
        await expect(provider.track({ ...base, [field]: value } as never)).rejects.toThrow(
          'privacy-safe analytics event',
        );
      }
    }
    await expect(
      provider.track({
        ...base,
        correlationId: { value: crypto.randomUUID() } as unknown as CorrelationId,
      }),
    ).rejects.toThrow('privacy-safe analytics event');
    await expect(
      provider.track({ ...base, notes: 'private evaluator note' } as never),
    ).rejects.toThrow('privacy-safe analytics event');
    expect(provider.events).toEqual([]);
  });

  it('returns a closed invalid analytics outcome when accessors or proxy traps throw', async () => {
    const throwing = Object.defineProperty({}, 'name', {
      enumerable: true,
      get: () => {
        throw new Error('sk_private private@example.com score_98');
      },
    });
    const trapped = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('bearer-secret-token private evaluator notes');
        },
      },
    );
    const provider = new FakeAnalyticsProvider();

    expect(() => serializeAnalyticsEvent(throwing)).not.toThrow();
    expect(serializeAnalyticsEvent(throwing)).toBeNull();
    expect(() => serializeAnalyticsEvent(trapped)).not.toThrow();
    expect(serializeAnalyticsEvent(trapped)).toBeNull();
    await expect(provider.track(throwing as never)).rejects.toThrow(
      'Invalid privacy-safe analytics event',
    );
    expect(provider.events).toEqual([]);
  });

  it('snapshots analytics accessors once and rejects inherited, symbol, array, and function input', () => {
    const values = {
      name: 'workflow.completed',
      workflow: 'evaluation_sync',
      organizationId,
      correlationId: createCorrelationId(),
    } as const;
    const reads = new Map<string, number>();
    const alternating: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      Object.defineProperty(alternating, key, {
        enumerable: true,
        get: () => {
          reads.set(key, (reads.get(key) ?? 0) + 1);
          return reads.get(key) === 1 ? value : 'sk_private';
        },
      });
    }
    const serialized = serializeAnalyticsEvent(alternating);
    expect(serialized).toEqual({
      name: 'workflow.completed',
      workflow: 'evaluation_sync',
      organizationId,
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    });
    expect(Object.fromEntries(reads)).toEqual({
      name: 1,
      workflow: 1,
      organizationId: 1,
      correlationId: 1,
    });

    const inherited = Object.create(values) as unknown;
    const symbol = Symbol('private evaluator notes');
    const withSymbol = { ...values, [symbol]: 'sk_private' };
    const array = Object.assign([], values);
    const callable = () => undefined;
    for (const [key, value] of Object.entries(values)) {
      Object.defineProperty(callable, key, { configurable: true, enumerable: true, value });
    }
    for (const value of [inherited, withSymbol, array, callable]) {
      expect(serializeAnalyticsEvent(value)).toBeNull();
    }

    const mutating: Record<string, unknown> = {
      workflow: 'evaluation_sync',
      organizationId,
      correlationId: createCorrelationId(),
    };
    Object.defineProperty(mutating, 'name', {
      configurable: true,
      enumerable: true,
      get: () => {
        Object.defineProperty(mutating, 'name', {
          configurable: true,
          enumerable: true,
          value: 'sk_private',
        });
        return 'workflow.completed';
      },
    });
    expect(serializeAnalyticsEvent(mutating)).toEqual({
      name: 'workflow.completed',
      workflow: 'evaluation_sync',
      organizationId,
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    });
    expect(mutating.name).toBe('sk_private');
  });
});
