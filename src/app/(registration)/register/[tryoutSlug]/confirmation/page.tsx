import {
  createDeterministicTestBotToken,
  isExactDeterministicBotTestEnvironment,
} from '../../../../../modules/identity/application/bot-protection';
import { RegistrationConfirmationClient } from './registration-confirmation-client';

export default function RegistrationConfirmationPage() {
  const deterministic = isExactDeterministicBotTestEnvironment(process.env);
  return (
    <RegistrationConfirmationClient
      botSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
      confirmationBotToken={deterministic ? createDeterministicTestBotToken() : undefined}
      reissueBotToken={deterministic ? createDeterministicTestBotToken() : undefined}
    />
  );
}
