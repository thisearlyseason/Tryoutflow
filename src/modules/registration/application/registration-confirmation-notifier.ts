/**
 * A future durable outbox adapter will implement this port.  Public submission
 * remains truthful while no delivery adapter is configured.
 */
export interface RegistrationConfirmationNotifier {
  enqueue(input: {
    registrationId: string;
    confirmationToken: string;
    guardianEmail: string;
  }): Promise<{ queued: true } | { queued: false; reason: 'not_configured' }>;
}

export const noRegistrationConfirmationNotifier: RegistrationConfirmationNotifier = {
  async enqueue() {
    return { queued: false, reason: 'not_configured' };
  },
};
