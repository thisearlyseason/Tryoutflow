import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createTryout } from '@/modules/tryouts/application/create-tryout';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';

export default async function NewTryoutPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const current = await requireCurrentOrganization(organizationSlug);
  async function create(formData: FormData) {
    'use server';
    const route = await requireCurrentOrganization(organizationSlug);
    const result = await createTryout(
      {
        organizationId: route.organization.id,
        name: formData.get('name'),
        sport: formData.get('sport'),
        timezone: formData.get('timezone'),
        registrationStartsAt: formData.get('registrationStartsAt') || undefined,
        registrationEndsAt: formData.get('registrationEndsAt') || undefined,
      },
      { authorization: route.authorization },
    );
    if (!result.ok) redirect(`/app/${organizationSlug}/tryouts/new?error=${result.error.code}`);
    redirect(`/app/${organizationSlug}/tryouts/${result.value.id}/setup/basics`);
  }
  return (
    <section aria-labelledby="new-tryout-heading" className="max-w-xl">
      <p className="eyebrow">Tryout setup</p>
      <h2 id="new-tryout-heading">Create a draft</h2>
      <form action={create} className="mt-6 space-y-4">
        <label className="block" htmlFor="name">
          <span className="font-bold">Tryout name</span>
          <Input id="name" name="name" required />
        </label>
        <label className="block" htmlFor="sport">
          <span className="font-bold">Sport</span>
          <Input
            defaultValue={current.organization.sportDefaults[0] ?? ''}
            id="sport"
            name="sport"
            required
          />
        </label>
        <label className="block" htmlFor="timezone">
          <span className="font-bold">Timezone</span>
          <Input
            defaultValue={current.organization.timezone}
            id="timezone"
            name="timezone"
            required
          />
        </label>
        <label className="block" htmlFor="registrationStartsAt">
          <span className="font-bold">Registration opens</span>
          <Input
            id="registrationStartsAt"
            name="registrationStartsAt"
            type="datetime-local"
            required
          />
        </label>
        <label className="block" htmlFor="registrationEndsAt">
          <span className="font-bold">Registration closes</span>
          <Input id="registrationEndsAt" name="registrationEndsAt" type="datetime-local" required />
        </label>
        <Button type="submit">Create draft</Button>
      </form>
    </section>
  );
}
