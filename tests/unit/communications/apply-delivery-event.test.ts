import { describe, expect, it } from 'vitest';

import {
  applyDeliveryEvent,
  parseResendEvent,
} from '../../../src/modules/communications/application/apply-delivery-event';

describe('delivery events', () => {
  it('advances monotonically without pretending an older event is current', () => {
    expect(applyDeliveryEvent('submitted', 'delivered')).toBe('delivered');
    expect(applyDeliveryEvent('delivered', 'sent')).toBe('delivered');
    expect(applyDeliveryEvent('bounced', 'delivered')).toBe('bounced');
    expect(applyDeliveryEvent('delivered', 'complained')).toBe('complained');
    expect(applyDeliveryEvent('submitted', 'failed')).toBe('failed');
    expect(applyDeliveryEvent('delivered', 'suppressed')).toBe('suppressed');
  });

  it('accepts only bounded Resend email evidence and exact message tags', () => {
    expect(
      parseResendEvent({
        type: 'email.delivered',
        created_at: '2026-08-30T12:00:00.000Z',
        data: {
          email_id: '11111111-1111-4111-8111-111111111111',
          tags: { message_id: '22222222-2222-4222-8222-222222222222' },
        },
      }),
    ).toMatchObject({ type: 'delivered' });
    expect(() => parseResendEvent({ type: 'email.opened', data: {} })).toThrow();
  });
});
