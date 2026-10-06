import {
  WorkspaceHeader,
  WorkspaceStats,
  SectionHeading,
  EmptyState,
} from '@/modules/talent/ui/workspace-ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadTalent } from '@/modules/talent/application/workspace';
import { EditRecord } from '@/modules/talent/ui/record-form';
import { LinkParticipantForm, ScoutingGrantButton } from '@/modules/talent/ui/participant-forms';
import { options } from '@/modules/talent/ui/fields';
export default async function Page({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug: slug } = await params;
  const w = await loadTalent(slug);
  const c = w.current;
  if (!['owner', 'administrator'].includes(c.authorization.organizationRole)) notFound();
  const [links, corrections, members, grants] = await Promise.all([
    c.client.from('participant_links').select('*').eq('organization_id', c.organization.id),
    c.client
      .from('athlete_corrections')
      .select('*')
      .eq('organization_id', c.organization.id)
      .order('created_at', { ascending: false }),
    c.client
      .from('organization_members')
      .select('user_id,role,status')
      .eq('organization_id', c.organization.id)
      .eq('status', 'active'),
    c.client.from('scouting_grants').select('user_id').eq('organization_id', c.organization.id),
  ]);
  if ([links, corrections, members, grants].some((r) => r.error))
    throw new Error('Access workspace could not load.');
  const name = (id: string) => {
    const a = w.athletes.find((a) => a.id === id);
    return a ? `${a.given_name} ${a.family_name}` : id;
  };
  return (
    <section className="talent-stack">
      <WorkspaceHeader
        eyebrow="Access & communication"
        title="Participant access"
        description="Connect athletes and families to their approved information, and manage your scouting team’s access."
      >
        <Link className="button-secondary" href="/participant">
          Open family portal →
        </Link>
      </WorkspaceHeader>
      <WorkspaceStats
        items={[
          {
            label: 'Active links',
            value: links.data?.filter((l) => l.active).length ?? 0,
            detail: 'Verified participant accounts',
          },
          {
            label: 'Athletes connected',
            value: new Set(links.data?.filter((l) => l.active).map((l) => l.athlete_id)).size,
            detail: 'With portal access',
          },
          {
            label: 'Pending corrections',
            value: corrections.data?.filter((r) => r.status === 'pending').length ?? 0,
            detail: 'Awaiting your review',
          },
          {
            label: 'Scouting grants',
            value: grants.data?.length ?? 0,
            detail: 'Additional staff access',
          },
        ]}
      />
      <details className="talent-editor">
        <summary>Link a participant account</summary>
        <LinkParticipantForm slug={slug} athletes={w.athletes} />
      </details>
      <SectionHeading
        title="Linked accounts"
        description="Participants see only approved information for their linked athletes."
      />
      {!links.data?.length && (
        <EmptyState
          title="No participant accounts linked"
          description="Use “Link a participant account” to connect an athlete or guardian after verifying their identity."
        />
      )}
      {links.data?.map((l) => (
        <article className="talent-card" key={l.id}>
          <h3>{name(l.athlete_id)}</h3>
          <p>
            {l.relationship} · {l.active ? 'Active' : 'Revoked'} · account {l.user_id}
          </p>
          <EditRecord
            slug={slug}
            table="participant_links"
            id={l.id}
            version={l.version}
            defaults={{
              athlete_id: l.athlete_id,
              user_id: l.user_id,
              relationship: l.relationship,
              active: l.active,
            }}
            fields={[
              {
                name: 'relationship',
                label: 'Relationship',
                type: 'select',
                required: true,
                options: options(['athlete', 'guardian']),
              },
              { name: 'active', label: 'Participant access active', type: 'checkbox' },
            ]}
            title="Manage access"
          />
        </article>
      ))}
      <SectionHeading
        title="Correction requests"
        description="Review family requests and keep athlete information accurate."
      />
      {corrections.data?.length ? (
        corrections.data.map((r) => (
          <article className="talent-card" key={r.id}>
            <h3>
              <Link href={`/app/${slug}/athletes/${r.athlete_id}`}>{name(r.athlete_id)}</Link>
            </h3>
            <p>{r.request_text}</p>
            <p>
              {r.status} · {r.response}
            </p>
            <p>Apply accepted changes in the athlete dossier, then record the resolution here.</p>
            <EditRecord
              slug={slug}
              table="athlete_corrections"
              id={r.id}
              version={r.version}
              defaults={{
                athlete_id: r.athlete_id,
                request_text: r.request_text,
                response: r.response,
                status: r.status,
              }}
              fields={[
                {
                  name: 'status',
                  label: 'Resolution',
                  type: 'select',
                  required: true,
                  options: options(['pending', 'resolved', 'declined']),
                },
                { name: 'response', label: 'Response to athlete / guardian', type: 'textarea' },
              ]}
              title="Resolve request"
            />
          </article>
        ))
      ) : (
        <p>No correction requests.</p>
      )}
      <SectionHeading title="Scouting access" />
      <p>
        Scouting grants allow access to sporting profiles, performance and shared scouting records
        across this organization. Financial, guardian and evaluator qualification records remain
        restricted.
      </p>
      {members.data
        ?.filter((m) => m.role === 'member')
        .map((m) => (
          <article className="talent-card" key={m.user_id}>
            <h3>{w.people.find((e) => e.user_id === m.user_id)?.display_name || 'Staff member'}</h3>
            <p className="talent-meta">
              Account ending {m.user_id.slice(-6)} ·{' '}
              <Link href={`/app/${slug}/organization/members`}>Verify member identity</Link>
            </p>
            <ScoutingGrantButton
              slug={slug}
              userId={m.user_id}
              enabled={!!grants.data?.some((g) => g.user_id === m.user_id)}
            />
          </article>
        ))}
    </section>
  );
}
