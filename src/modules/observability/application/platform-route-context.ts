import { notFound } from 'next/navigation';

import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import { AppError } from '../domain/app-error';
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
    if (error instanceof AppError && error.category === 'permission') notFound();
    if (error instanceof AppError) throw error;
    throw new AppError('platform_unavailable');
  }
  return { client, gateway, user };
}
