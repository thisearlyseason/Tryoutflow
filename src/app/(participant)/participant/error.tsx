'use client';
import { ErrorState } from '@/components/feedback/error-state';
import { FeedbackButton } from '@/components/ui/button';

export default function ParticipantError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="talent-stack">
      <h1>Family portal unavailable</h1>
      <ErrorState
        title="Your information could not load"
        description="Try again. You can still open Account, get help or sign out above."
        action={
          <FeedbackButton className="button-secondary" onClick={reset} type="button">
            Try again
          </FeedbackButton>
        }
      />
    </section>
  );
}
