'use client';
import { useSearchParams } from 'next/navigation';
export function StartPlan() {
  const params = useSearchParams();
  return <input type="hidden" name="plan" value={params?.get('plan') === 'pro' ? 'pro' : ''} />;
}
