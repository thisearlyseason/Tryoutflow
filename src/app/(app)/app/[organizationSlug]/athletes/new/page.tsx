import { talentContext } from '@/modules/talent/application/workspace';
import { IdentityForm } from '@/modules/talent/ui/identity-form';
import { notFound } from 'next/navigation';
export default async function NewAthlete({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const c = await talentContext(organizationSlug);
  if (!['owner', 'administrator'].includes(c.authorization.organizationRole)) notFound();
  return <IdentityForm slug={organizationSlug} headingLevel={1} />;
}

export const metadata = { title: 'Add a prospect | TryoutFlow' };
