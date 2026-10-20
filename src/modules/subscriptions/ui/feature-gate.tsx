'use client';
import { useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import Link from 'next/link';
import { trackBilling } from './billing-analytics';
import { Button } from '@/components/ui/button';
import { FEATURE_CATALOG, type FeatureKey } from '../domain/feature-catalog';
import { hasEntitlement, type EffectiveEntitlements } from '../domain/effective-entitlements';
/** UX only. Every protected operation must also use the server/SQL entitlement boundary. */
export function FeatureGate({
  access,
  feature,
  billingHref,
  children,
}: {
  access: EffectiveEntitlements;
  feature: FeatureKey;
  billingHref: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (hasEntitlement(access, feature)) return children;
  const details = FEATURE_CATALOG[feature];
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) trackBilling(access.organizationId, 'upgrade_prompt_viewed');
      }}
    >
      <div className="workspace-card">
        <h2 className="text-xl font-bold">{details.name}</h2>
        <p className="my-3">{details.description}</p>
        <Dialog.Trigger asChild>
          <Button>Explore {details.tier === 'organization' ? 'Organization' : 'Pro'}</Button>
        </Dialog.Trigger>
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-[var(--color-surface)] p-7 shadow-xl">
          <Dialog.Title className="text-2xl font-black">
            {details.name} is available with TryOutFlow{' '}
            {details.tier === 'organization' ? 'Organization' : 'Pro'}.
          </Dialog.Title>
          <Dialog.Description className="my-4">
            {details.description} Your current plan is {access.plan}. Your existing data stays safe
            when your plan changes.
          </Dialog.Description>
          <div className="flex flex-wrap gap-3">
            <Link className="button-primary p-3" href={billingHref}>
              View plans
            </Link>
            <Dialog.Close asChild>
              <Button variant="secondary">Close</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
