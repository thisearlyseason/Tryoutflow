'use client';

import { useState } from 'react';

import type { PaidPlanKey } from '../domain/plans';
import { PlanCard } from './plan-card';

type DisplayPlan = Readonly<{
  key: PaidPlanKey;
  name: string;
  monthlyPriceCad: number;
}>;

export function PlanGrid({
  disabled,
  organizationId,
  plans,
}: {
  disabled: boolean;
  organizationId: string;
  plans: readonly DisplayPlan[];
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-3">
      {plans.map((plan) => (
        <PlanCard
          disabled={disabled}
          globallyBusy={busy}
          key={plan.key}
          onBusyChange={setBusy}
          organizationId={organizationId}
          plan={plan}
        />
      ))}
    </div>
  );
}
