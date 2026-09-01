import {
  createDeterministicTestBotToken,
  isExactDeterministicBotTestEnvironment,
  type BotAction,
} from '../application/bot-protection';
import { TurnstileClientChallenge } from './turnstile-client';

export function BotChallenge({ action }: { action: BotAction }) {
  if (isExactDeterministicBotTestEnvironment(process.env)) {
    return (
      <TurnstileClientChallenge
        action={action}
        deterministicToken={createDeterministicTestBotToken()}
      />
    );
  }
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!siteKey) {
    return <TurnstileClientChallenge action={action} />;
  }
  return <TurnstileClientChallenge action={action} siteKey={siteKey} />;
}
