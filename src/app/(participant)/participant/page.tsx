import { redirect } from 'next/navigation';
import { PrivateSessionBoundary } from '@/modules/identity/ui/private-session-boundary';
import { createServerSupabaseClient } from '@/infrastructure/supabase/server';
import { ProductBrandBar } from '@/components/layout/product-brand-bar';
import {
  FamilyWorkspace,
  type FamilyPerson,
  type FamilyOffer,
  type FamilySession,
  type FamilyRegistration,
} from '@/modules/talent/ui/family-workspace';

export default async function Page() {
  const client = await createServerSupabaseClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect('/sign-in?next=/participant');
  const [workspace, offers, schedule, options] = await Promise.all([
    client.rpc('participant_workspace'),
    client.rpc('participant_offers'),
    client.rpc('participant_schedule'),
    client.rpc('participant_registration_options'),
  ]);
  if ([workspace, offers, schedule, options].some((result) => result.error))
    throw new Error('Family information could not load.');
  return (
    <PrivateSessionBoundary userId={user.id}>
      <div className="participant-shell">
        <ProductBrandBar label="Athlete and family portal" homeHref="/" />
        <FamilyWorkspace
          people={
            (Array.isArray(workspace.data) ? workspace.data : []) as unknown as FamilyPerson[]
          }
          offers={(offers.data ?? []) as unknown as FamilyOffer[]}
          schedule={(schedule.data ?? []) as unknown as FamilySession[]}
          registrationOptions={(options.data ?? []) as unknown as FamilyRegistration[]}
        />
      </div>
    </PrivateSessionBoundary>
  );
}
