import type { InvitationNotifier } from '../domain/organization';

/** Deliberately non-delivering until Task 22 provides an outbox-backed adapter. */
export class NoopInvitationNotifier implements InvitationNotifier {
  async enqueue(): Promise<void> {}
}
