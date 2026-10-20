import { z } from 'zod';
import { createServerSupabaseClient } from '@/infrastructure/supabase/server';
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
  searchParams: Promise<{ __testLoaderFailure?: string; athlete?: string }>;
}) {
  const [{ tryoutSlug }, query] = await Promise.all([params, searchParams]);
  let prefill: Record<string, string> | undefined;
  if (query.athlete && z.uuid().safeParse(query.athlete).success) {
    const client = await createServerSupabaseClient();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (user) {
      const r = await client.rpc('participant_registration_prefill', {
        p_tryout_slug: tryoutSlug,
        p_athlete_id: query.athlete,
      });
      const parsed = z
        .object({ givenName: z.string(), familyName: z.string(), birthDate: z.string() })
        .safeParse(r.data);
      if (!r.error && parsed.success) prefill = parsed.data;
    }
  }
  return (
    <RegistrationForm
      tryoutSlug={tryoutSlug}
      prefill={prefill}
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
