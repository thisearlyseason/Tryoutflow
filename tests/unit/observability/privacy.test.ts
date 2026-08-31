import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { AppError, type AppErrorCode } from '../../../src/modules/observability/domain/app-error';
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

const organizationId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const unsafeValues = [
  'private@example.com',
  '+1 555 555 5555',
  'score_98',
  'private evaluator notes',
  'sk_private',
  'bearer-secret-token',
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
});
