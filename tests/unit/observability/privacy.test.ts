import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  AppError,
  type AppErrorCategory,
} from '../../../src/modules/observability/domain/app-error';
import {
  logError,
  redactLogContext,
  type OperationalLogger,
} from '../../../src/modules/observability/application/log-error';
import { FakeAnalyticsProvider } from '../../../src/infrastructure/analytics/fake-analytics-provider';

const organizationId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';

describe('privacy-safe observability', () => {
  it('classifies every application error category without exposing its internal cause', () => {
    const categories: AppErrorCategory[] = [
      'validation',
      'permission',
      'conflict',
      'network',
      'integration',
      'unexpected',
    ];

    expect(
      categories.map((category) =>
        new AppError({
          category,
          code: `${category}_failure`,
          message: 'A safe recovery message.',
          cause: new Error('provider token sk_private must not escape'),
        }).toJSON(),
      ),
    ).toEqual(
      categories.map((category) => ({
        category,
        code: `${category}_failure`,
        message: 'A safe recovery message.',
      })),
    );
  });

  it('constructs log metadata from an identifier allow-list', () => {
    expect(
      redactLogContext({
        organizationId,
        actorId,
        requestId: 'request_01HF4J8M8M4VK8TQXV0E9PKM31',
        correlationId: 'correlation_01HF4J8M8M4VK8TQXV0E9PKM31',
        operation: 'health.read',
        code: 'database_unavailable',
        score: 9.8,
        notes: 'private evaluator note',
        guardianEmail: 'private@example.com',
        guardianPhone: '+1 555 555 5555',
        providerSecret: 'sk_private',
        accessToken: 'bearer-secret',
        rawPayload: { athleteName: 'Private Athlete' },
      }),
    ).toEqual({
      actorId,
      code: 'database_unavailable',
      correlationId: 'correlation_01HF4J8M8M4VK8TQXV0E9PKM31',
      operation: 'health.read',
      organizationId,
      requestId: 'request_01HF4J8M8M4VK8TQXV0E9PKM31',
    });
  });

  it('drops malformed or unbounded correlation values', () => {
    expect(
      redactLogContext({
        organizationId: 'not-a-uuid',
        requestId: 'private@example.com',
        correlationId: `corr_${'x'.repeat(128)}`,
        operation: 'health read',
        code: '../secret',
      }),
    ).toEqual({});
  });

  it('logs only the safe error taxonomy and allow-listed context', () => {
    const records: unknown[] = [];
    const logger: OperationalLogger = { error: (record) => records.push(record) };

    logError(logger, new Error('guardian private@example.com token sk_private'), {
      organizationId,
      actorId,
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
    expect(JSON.stringify(records)).not.toContain('private@example.com');
    expect(JSON.stringify(records)).not.toContain('sk_private');
    expect(JSON.stringify(records)).not.toContain('evaluator note');
  });

  it('replaces an unsafe application error code instead of logging it', () => {
    const records: unknown[] = [];
    const logger: OperationalLogger = { error: (record) => records.push(record) };

    logError(
      logger,
      new AppError({
        category: 'integration',
        code: 'provider token sk_private',
        message: 'The integration is unavailable.',
      }),
    );

    expect(records).toEqual([
      {
        category: 'integration',
        code: 'unexpected_error',
        context: {},
        level: 'error',
      },
    ]);
    expect(JSON.stringify(records)).not.toContain('sk_private');
  });

  it('rejects analytics metadata outside the privacy-safe workflow contract', async () => {
    const provider = new FakeAnalyticsProvider();

    await expect(
      provider.track({
        name: 'workflow.completed',
        workflow: 'evaluation_sync',
        organizationId,
        correlationId: 'correlation_01HF4J8M8M4VK8TQXV0E9PKM31',
        score: 9.8,
        notes: 'private evaluator note',
        guardianEmail: 'private@example.com',
        token: 'secret',
      } as never),
    ).rejects.toThrow('privacy-safe analytics event');
    expect(provider.events).toEqual([]);
  });
});
