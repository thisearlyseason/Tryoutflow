import { notFound } from 'next/navigation';

import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import { AppError, appErrorDetails } from '../domain/app-error';
import { SupabasePlatformAdministrationGateway } from '../infrastructure/supabase-platform-administration-gateway';

/** Reauthorizes current durable platform authority for every protected page render/action. */
export async function requirePlatformRouteContext() {
  const client = await createServerSupabaseClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) notFound();
  const gateway = new SupabasePlatformAdministrationGateway(client);
  try {
    await gateway.health();
  } catch (error) {
    const details = appErrorDetails(error);
    if (details.category === 'permission') notFound();
    throw new AppError(details.code === 'unexpected_error' ? 'platform_unavailable' : details.code);
  }
  return { client, gateway, user };
}
