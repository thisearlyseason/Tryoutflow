import { describe, expect, it, vi } from 'vitest';

import { handleExportRequest } from '../../../src/app/api/organizations/[organizationId]/exports/[exportType]/route';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';

const organizationId = '29000000-0000-4000-8000-000000000001';
const tryoutId = '29000000-0000-4000-8000-000000000002';
const actor: AuthorizationContext = {
  userId: '29000000-0000-4000-8000-000000000003' as AuthorizationContext['userId'],
  organizationId: organizationId as AuthorizationContext['organizationId'],
  organizationRole: 'owner',
  membershipStatus: 'active',
  assignments: [],
};

describe('CSV export route', () => {
  it('streams an authorized UTF-8 attachment with safe exact headers', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        chunks: [
          new TextEncoder().encode('Athlete number,Preferred name\r\n'),
          new TextEncoder().encode('7,Zoë\r\n'),
        ],
        byteLength: 45,
        filename: 'Badlands-U15-athletes.csv',
        rowCount: 1,
        truncated: false,
      },
    });
    const response = await handleExportRequest(
      new Request(`http://localhost/api/x?tryoutId=${tryoutId}`),
      { organizationId, exportType: 'athletes' },
      { authorize: async () => actor, execute },
    );

    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="Badlands-U15-athletes.csv"',
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-export-row-count')).toBe('1');
    expect(response.headers.get('x-export-truncated')).toBe('false');
    expect(await response.text()).toContain('Zoë');
    expect(execute).toHaveBeenCalledWith(
      { organizationId, tryoutId, rosterVersionId: undefined, exportType: 'athletes' },
      actor,
    );
  });

  it('pulls one encoded chunk at a time and stops after consumer cancellation', async () => {
    const response = await handleExportRequest(
      new Request(`http://localhost/api/x?tryoutId=${tryoutId}`),
      { organizationId, exportType: 'athletes' },
      {
        authorize: async () => actor,
        execute: async () => ({
          ok: true,
          value: {
            chunks: [
              new TextEncoder().encode('header\r\n'),
              new TextEncoder().encode('first\r\n'),
              new TextEncoder().encode('second\r\n'),
            ],
            byteLength: 23,
            filename: 'report.csv',
            rowCount: 2,
            truncated: false,
          },
        }),
      },
    );
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('header\r\n');
    await reader.cancel('slow consumer disconnected');
    expect(await reader.read()).toEqual({ done: true, value: undefined });
  });

  it('maps an asynchronous execution rejection to a private typed 503 response', async () => {
    const response = await handleExportRequest(
      new Request(`http://localhost/api/x?tryoutId=${tryoutId}`),
      { organizationId, exportType: 'athletes' },
      {
        authorize: async () => actor,
        execute: async () => {
          throw new Error('sensitive database detail');
        },
      },
    );
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('The export is temporarily unavailable.');
    expect(response.headers.get('content-type')).not.toBe('text/csv; charset=utf-8');
  });

  it('does not start projection work for an already aborted request', async () => {
    const controller = new AbortController();
    controller.abort('navigation changed');
    const execute = vi.fn();
    const response = await handleExportRequest(
      new Request(`http://localhost/api/x?tryoutId=${tryoutId}`, { signal: controller.signal }),
      { organizationId, exportType: 'athletes' },
      { authorize: async () => actor, execute },
    );
    expect(response.status).toBe(499);
    expect(execute).not.toHaveBeenCalled();
    expect(response.headers.get('content-type')).not.toBe('text/csv; charset=utf-8');
  });

  it('stops a Unicode stream on request abort between pull chunks', async () => {
    const controller = new AbortController();
    const response = await handleExportRequest(
      new Request(`http://localhost/api/x?tryoutId=${tryoutId}`, { signal: controller.signal }),
      { organizationId, exportType: 'athletes' },
      {
        authorize: async () => actor,
        execute: async () => ({
          ok: true,
          value: {
            chunks: [
              new TextEncoder().encode('name\r\n'),
              new TextEncoder().encode('Zoë 守門員\r\n'),
            ],
            byteLength: 24,
            filename: 'report.csv',
            rowCount: 1,
            truncated: false,
          },
        }),
      },
    );
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('name\r\n');
    controller.abort('client disconnected');
    await expect(reader.read()).rejects.toBe('client disconnected');
  });

  it('uses one non-oracular response for invalid IDs, missing sessions, and denied scope', async () => {
    for (const scenario of [
      { organizationId: 'bad', authorize: vi.fn(), execute: vi.fn() },
      { organizationId, authorize: vi.fn().mockResolvedValue(null), execute: vi.fn() },
      {
        organizationId,
        authorize: vi.fn().mockResolvedValue(actor),
        execute: vi.fn().mockResolvedValue({ ok: false, error: { code: 'forbidden' } }),
      },
    ]) {
      const response = await handleExportRequest(
        new Request('http://localhost/api/x'),
        { organizationId: scenario.organizationId, exportType: 'athletes' },
        { authorize: scenario.authorize, execute: scenario.execute },
      );
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Export not found.');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
  });

  it('reports immutable-roster, size, and transient failures truthfully without internals', async () => {
    for (const [code, status, body] of [
      ['not_finalized', 409, 'Only a finalized roster can be exported.'],
      [
        'too_large',
        413,
        'This export exceeds the download limit. Narrow the report and try again.',
      ],
      ['unexpected', 503, 'The export is temporarily unavailable.'],
    ] as const) {
      const response = await handleExportRequest(
        new Request(`http://localhost/api/x?tryoutId=${tryoutId}`),
        { organizationId, exportType: 'roster' },
        {
          authorize: async () => actor,
          execute: async () => ({ ok: false, error: { code } }),
        },
      );
      expect(response.status).toBe(status);
      expect(await response.text()).toBe(body);
    }
  });
});
