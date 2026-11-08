import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';

export const metadata: Metadata = { title: 'People | TryoutFlow' };

export default async function PeoplePage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const current = await requireCurrentOrganization(organizationSlug);
  if (!['owner', 'administrator'].includes(current.authorization.organizationRole)) notFound();
  const base = `/app/${current.organization.slug}`;
  const tools = [
    {
      title: 'Members and invitations',
      href: `${base}/organization/members`,
      description:
        'Invite staff and manage their organization roles. Tryout assignments determine what each person can do at an event.',
    },
    {
      title: 'Evaluators',
      href: `${base}/evaluators`,
      description:
        'Review evaluator profiles and experience. Assign evaluators to a specific tryout from its Staff page.',
    },
    {
      title: 'Participant access',
      href: `${base}/participants`,
      description:
        'Manage family access to linked athletes and approved information. Participant access is separate from staff permissions.',
    },
  ];
  return (
    <section className="workspace-stack">
      <PageHeader
        title="People"
        description="Bring staff into your workspace and manage family access in the right place."
      />
      <p className="max-w-3xl text-sm text-[var(--color-text-muted)]">
        Invite staff first, then open a tryout’s Staff page to assign their event tasks.
        Organization membership and tryout assignments are separate.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        {tools.map((tool) => (
          <article className="workspace-card" key={tool.href}>
            <h2>
              <Link className="min-h-11 inline-flex items-center" href={tool.href} prefetch={false}>
                {tool.title}
              </Link>
            </h2>
            <p>{tool.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
