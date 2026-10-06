'use client';
import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { BillingDashboardPanel } from './billing-dashboard';
import { billingDashboardSchema, type BillingDashboard } from '../domain/billing-dashboard';
export function PlatformBillingControls() {
  const [organization, setOrganization] = useState(''),
    [dashboard, setDashboard] = useState<BillingDashboard | null>(null),
    [reason, setReason] = useState(''),
    [product, setProduct] = useState('pro_monthly'),
    [expires, setExpires] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function request(action: string, revokeId?: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/platform/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          organizationId: organization,
          product,
          reason,
          expiresAt: expires ? new Date(expires).toISOString() : null,
          revokeId,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setDashboard(billingDashboardSchema.parse(data));
      setMessage(action === 'inspect' ? 'Billing records loaded.' : 'Promotional access updated.');
    } catch {
      setMessage('Unable to update billing. Check the organization, reason, and expiration date.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="workspace-stack my-8">
      <div className="workspace-card">
        <h2 className="text-2xl font-bold">Organization billing & promotional access</h2>
        <label className="mt-4 block">
          Organization ID
          <input
            className="mt-2 block w-full rounded border p-3"
            value={organization}
            onChange={(e) => {
              setOrganization(e.target.value);
              setDashboard(null);
            }}
          />
        </label>
        <Button className="mt-4" busy={busy} onClick={() => request('inspect')}>
          Inspect billing
        </Button>
        {dashboard ? (
          <div className="mt-6 grid gap-4">
            <label>
              Plan
              <select
                className="ml-3 rounded border p-3"
                value={product}
                onChange={(e) => setProduct(e.target.value)}
              >
                <option value="pro_monthly">Pro</option>
                <option value="organization_monthly">Organization</option>
              </select>
            </label>
            <label>
              Reason
              <input
                className="mt-2 block w-full rounded border p-3"
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <label>
              Expires
              <input
                className="ml-3 rounded border p-3"
                type="datetime-local"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
              />
            </label>
            <Button busy={busy} disabled={!reason || !expires} onClick={() => request('grant')}>
              Grant promotional access
            </Button>
            {dashboard.overrides
              .filter((o) => !o.revoked_at)
              .map((o) => (
                <Button
                  key={o.id}
                  busy={busy}
                  variant="secondary"
                  onClick={() => request('revoke', o.id)}
                >
                  Revoke: {o.reason}
                </Button>
              ))}
          </div>
        ) : null}
        {message ? (
          <p className="mt-4" role="status">
            {message}
          </p>
        ) : null}
      </div>
      {dashboard ? (
        <BillingDashboardPanel
          readOnly
          initial={dashboard}
          key={JSON.stringify(dashboard)}
          organizationId={organization}
          products={[]}
          tryouts={[]}
        />
      ) : null}
    </section>
  );
}
