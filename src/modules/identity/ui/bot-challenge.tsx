import 'server-only';

import {
  createDeterministicTestBotToken,
  isExactDeterministicBotTestEnvironment,
  type BotAction,
} from '../application/bot-protection';
import { TurnstileClientChallenge } from './turnstile-client';

export function getBotChallengeConfiguration() {
  if (isExactDeterministicBotTestEnvironment(process.env)) {
    return { deterministicToken: createDeterministicTestBotToken() };
  }
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  return siteKey ? { siteKey } : {};
}

export function BotChallenge({ action }: { action: BotAction }) {
  return <TurnstileClientChallenge action={action} {...getBotChallengeConfiguration()} />;
}
