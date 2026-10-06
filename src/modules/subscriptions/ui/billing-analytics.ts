'use client';
/** Product analytics carry no customer, payment, provider IDs or freeform payload. Never grants access. */
export function trackBilling(organizationId: string, event: string) {
  void fetch(`/api/organizations/${organizationId}/billing/analytics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: crypto.randomUUID(), event }),
    keepalive: true,
  }).catch(() => {});
}
