import { RegistrationForm } from './registration-form';
import {
  createDeterministicTestBotToken,
  isExactDeterministicBotTestEnvironment,
} from '../../../../modules/identity/application/bot-protection';

export default async function PublicRegistrationPage({
  params,
}: {
  params: Promise<{ tryoutSlug: string }>;
}) {
  const { tryoutSlug } = await params;
  return (
    <RegistrationForm
      tryoutSlug={tryoutSlug}
      botSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
      deterministicBotToken={
        isExactDeterministicBotTestEnvironment(process.env)
          ? createDeterministicTestBotToken()
          : undefined
      }
    />
  );
}
