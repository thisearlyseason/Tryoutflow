// @vitest-environment node

import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn().mockResolvedValue({ data: 'delivered', error: null });
vi.mock('../../../src/infrastructure/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({ rpc }),
}));

import { GET, POST, readBoundedRawBody } from '../../../src/app/api/webhooks/resend/route';

afterEach(() => {
  vi.unstubAllEnvs();
  rpc.mockClear();
});

describe('Resend webhook boundary', () => {
  it('caps the raw body while reading the stream', async () => {
    const request = new Request('https://tryoutflow.example/api/webhooks/resend', {
      method: 'POST',
      body: 'x'.repeat(33),
    });
    await expect(readBoundedRawBody(request, 32)).rejects.toThrow('body_too_large');
  });

  it('rejects wrong media types and stale signatures without exposing secrets', async () => {
    const media = await POST(
      new Request('https://tryoutflow.example/api/webhooks/resend', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: '{}',
      }),
    );
    expect(media.status).toBe(415);
    const stale = await POST(
      new Request('https://tryoutflow.example/api/webhooks/resend', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'svix-id': 'msg_task23stale001',
          'svix-timestamp': '1600000000',
          'svix-signature': 'v1,invalid',
        },
        body: '{}',
      }),
    );
    expect(stale.status).toBe(400);
    expect(await stale.text()).not.toMatch(/secret|signature.*v1|stack/i);
  });

  it('permits only POST', async () => {
    const response = await GET();
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('verifies the official raw-body signature and applies one bounded event', async () => {
    const secretBytes = Buffer.from('task23-webhook-secret-material-32!');
    const secret = `whsec_${secretBytes.toString('base64')}`;
    const id = 'msg_task23signed001';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = JSON.stringify({
      type: 'email.delivered',
      created_at: new Date().toISOString(),
      data: {
        email_id: '11111111-1111-4111-8111-111111111111',
        tags: { message_id: '22222222-2222-4222-8222-222222222222' },
      },
    });
    const signature = createHmac('sha256', secretBytes)
      .update(`${id}.${timestamp}.${payload}`)
      .digest('base64');
    vi.stubEnv('RESEND_API_KEY', `re_${'x'.repeat(30)}`);
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret);
    const response = await POST(
      new Request('https://tryoutflow.example/api/webhooks/resend', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'svix-id': id,
          'svix-timestamp': timestamp,
          'svix-signature': `v1,${signature}`,
        },
        body: payload,
      }),
    );
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      'apply_resend_delivery_event',
      expect.objectContaining({
        p_event_id: id,
        p_message_id: '22222222-2222-4222-8222-222222222222',
      }),
    );
  });
});
