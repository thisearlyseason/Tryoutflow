import { describe, expect, it, vi } from 'vitest';

import {
  SupabaseAnalyticsProvider,
  trackWorkflowSafely,
} from '../../../src/infrastructure/analytics/supabase-analytics-provider';
import {
  logErrorSafely,
  type OperationalErrorRecord,
} from '../../../src/modules/observability/application/log-error';
import { createCorrelationId } from '../../../src/modules/observability/domain/correlation-id';
import { shouldInjectTestLoaderFailure } from '../../../src/modules/observability/application/test-failure-boundary';

const organizationId = '11111111-1111-4111-8111-111111111111';
const memberId = '22222222-2222-4222-8222-222222222222';
const registrationId = '33333333-3333-4333-8333-333333333333';
const tryoutId = '44444444-4444-4444-8444-444444444444';

describe('runtime observability adapters', () => {
  it('permits loader injection only at the exact local production browser-test boundary', () => {
    const exact = {
      NODE_ENV: 'production',
      TRYOUTFLOW_SERVER_TEST_ENV: 'task30-playwright',
      NEXT_PUBLIC_APP_URL: 'https://task30.e2e.example.test',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    };
    expect(shouldInjectTestLoaderFailure('tryouts', 'tryouts', exact)).toBe(true);
    expect(shouldInjectTestLoaderFailure('messages', 'tryouts', exact)).toBe(false);
    for (const key of Object.keys(exact))
      expect(
        shouldInjectTestLoaderFailure('tryouts', 'tryouts', {
          ...exact,
          [key]: `${exact[key as keyof typeof exact]}-other`,
        }),
      ).toBe(false);
  });

  it('queues only a closed privacy-safe analytics projection', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ outcome: 'queued', event_id: '22222222-2222-4222-8222-222222222222' }],
      error: null,
    });
    const provider = new SupabaseAnalyticsProvider({ rpc });

    await provider.track({
      name: 'workflow.completed',
      workflow: 'registration',
      organizationId,
      correlationId: createCorrelationId(),
    });

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('enqueue_analytics_event', {
      p_correlation_id: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      p_event_name: 'workflow.completed',
      p_organization_id: organizationId,
      p_workflow: 'registration',
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(
      /score|note|guardian|provider|token|private@example\.test/u,
    );
  });

  it('rejects runtime-added sensitive analytics fields without calling the sink', async () => {
    const rpc = vi.fn();
    const provider = new SupabaseAnalyticsProvider({ rpc });

    await expect(
      provider.track({
        name: 'workflow.completed',
        workflow: 'registration',
        organizationId,
        correlationId: createCorrelationId(),
        guardianEmail: 'private@example.test',
        notes: 'private evaluator note',
        score: 98,
        providerToken: 'secret-token',
      } as never),
    ).rejects.toThrow('privacy-safe analytics event');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('never lets analytics or logging sink failure break the completed core write', async () => {
    let persisted = false;
    persisted = true;
    const provider = {
      track: vi.fn().mockRejectedValue(new Error('private@example.test provider token')),
    };
    const capture = vi.fn(() => {
      throw new Error('logger unavailable');
    });

    await expect(
      trackWorkflowSafely(
        provider,
        {
          name: 'workflow.completed',
          workflow: 'tryout_setup',
          organizationId,
          correlationId: createCorrelationId(),
        },
        capture,
      ),
    ).resolves.toBeUndefined();
    expect(persisted).toBe(true);
    expect(capture).toHaveBeenCalledOnce();
  });

  it('constructs a closed record before swallowing a production logger failure', () => {
    const records: OperationalErrorRecord[] = [];
    expect(() =>
      logErrorSafely(
        {
          error(record) {
            records.push(record);
            throw new Error('sink failed');
          },
        },
        new Error('guardian private@example.test score 98 token secret'),
        {
          memberId,
          organizationId,
          operation: 'tryouts.load',
          registrationId,
          notes: 'private evaluator note',
          tryoutId,
        },
      ),
    ).not.toThrow();
    expect(records).toEqual([
      {
        category: 'unexpected',
        code: 'unexpected_error',
        context: { memberId, organizationId, operation: 'tryouts.load', registrationId, tryoutId },
        level: 'error',
      },
    ]);
    expect(JSON.stringify(records)).not.toMatch(/guardian|score|token|note|private@example/u);
  });
});
