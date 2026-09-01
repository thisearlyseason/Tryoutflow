import { RegistrationForm } from './registration-form';
import {
  createDeterministicTestBotToken,
  isExactDeterministicBotTestEnvironment,
} from '../../../../modules/identity/application/bot-protection';
import { shouldInjectTestLoaderFailure } from '../../../../modules/observability/application/test-failure-boundary';

export default async function PublicRegistrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ tryoutSlug: string }>;
  searchParams: Promise<{ __testLoaderFailure?: string }>;
}) {
  const [{ tryoutSlug }, query] = await Promise.all([params, searchParams]);
  return (
    <RegistrationForm
      tryoutSlug={tryoutSlug}
      botSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
      deterministicBotToken={
        isExactDeterministicBotTestEnvironment(process.env)
          ? createDeterministicTestBotToken()
          : undefined
      }
      testLoaderFailure={
        shouldInjectTestLoaderFailure(query.__testLoaderFailure, 'public-registration')
          ? query.__testLoaderFailure
          : undefined
      }
    />
  );
}
