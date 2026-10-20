import { StatusBadge } from '../../../components/ui/status-badge';

const labels: Record<string, string> = {
  queued: 'Queued',
  delivery_uncertain: 'Delivery needs review',
  submitted: 'Submitted to provider',
  delivery_delayed: 'Delivery delayed',
  delivered: 'Delivered',
  failed: 'Failed',
  bounced: 'Bounced',
  suppressed: 'Suppressed',
  complained: 'Spam complaint',
  cancelled: 'Cancelled',
};

export function DeliveryStatus({ state }: { state: string }) {
  const label = labels[state] ?? 'Unknown status';
  const status =
    state === 'delivered' ? 'complete' : state === 'submitted' ? 'in-progress' : 'waitlisted';
  return <StatusBadge status={status}>{label}</StatusBadge>;
}
