import {
  FamilyInvitationForm,
  RevokeFamilyInvitationButton,
} from '@/modules/talent/ui/family-invitation-form';
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
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ athlete?: string }>;
}) {
  const selected = (await searchParams).athlete;
  const { organizationSlug: slug } = await params;
  const w = await loadTalent(slug);
  const c = w.current;
  if (!['owner', 'administrator'].includes(c.authorization.organizationRole)) notFound();
  const [links, corrections, members, grants, invitations] = await Promise.all([
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
    c.client
      .from('family_invitations')
      .select('id,athlete_id,email,relationship,created_at,expires_at,revoked_at,accepted_at')
      .eq('organization_id', c.organization.id)
      .order('created_at', { ascending: false })
      .limit(100),
  ]);
  if ([links, corrections, members, grants, invitations].some((r) => r.error))
    throw new Error('Access workspace could not load.');
  const name = (id: string) => {
    const a = w.athletes.find((a) => a.id === id);
    return a ? `${a.given_name} ${a.family_name}` : id;
  };
  return (
    <section className="talent-stack">
      <WorkspaceHeader
        eyebrow="Access & communication"
        title="Families & access"
        description="Invite a family. Connect the right athlete. Keep their access clear."
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
        ]}
      />
      <FamilyInvitationForm slug={slug} athletes={w.athletes} selectedAthlete={selected} />
      <SectionHeading
        title="Family invitations"
        description="Latest 100 invitations. Pending links expire after 7 days."
      />
      <div className="talent-grid">
        {invitations.data?.length ? (
          invitations.data.map((invitation) => {
            const pending =
              !invitation.accepted_at &&
              !invitation.revoked_at &&
              new Date(invitation.expires_at).getTime() > Date.now();
            const status = invitation.accepted_at
              ? 'Connected'
              : invitation.revoked_at
                ? 'Revoked'
                : pending
                  ? 'Pending acceptance'
                  : 'Expired';
            return (
              <article className="talent-card family-access-card" key={invitation.id}>
                <span className="family-state">{status}</span>
                <h3>{name(invitation.athlete_id)}</h3>
                <p>{invitation.email}</p>
                <p className="talent-meta">
                  {invitation.relationship} · Expires{' '}
                  {new Date(invitation.expires_at).toLocaleDateString('en-CA', { timeZone: 'UTC' })}
                </p>
                {pending ? (
                  <RevokeFamilyInvitationButton slug={slug} id={invitation.id} />
                ) : invitation.accepted_at ? (
                  <a className="button-secondary" href="#linked-family-accounts">
                    Manage family access
                  </a>
                ) : null}
              </article>
            );
          })
        ) : (
          <EmptyState
            title="Your next connection starts here"
            description="Create an invitation above. The family can create an account or use their existing one."
          />
        )}
      </div>
      <details className="talent-editor">
        <summary>Link an existing verified account directly</summary>
        <LinkParticipantForm slug={slug} athletes={w.athletes} />
      </details>
      <div id="linked-family-accounts">
        <SectionHeading
          title="Linked accounts"
          description="Participants see only approved information for their linked athletes."
        />
      </div>
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
            {l.relationship} · {l.active ? 'Active family access' : 'Revoked'}
          </p>
          <details className="family-profile-details">
            <summary>Account reference</summary>
            <p>{l.user_id}</p>
          </details>
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
      <details className="talent-editor">
        <summary>Staff scouting permissions</summary>
        <SectionHeading
          title="Staff scouting permissions"
          description="Separate from family portal links. These permissions let staff use scouting tools; they do not link a family to an athlete."
        />
        <p>
          Scouting grants allow access to sporting profiles, performance and shared scouting records
          across this organization. Financial, guardian and evaluator qualification records remain
          restricted.
        </p>
        {members.data
          ?.filter((m) => m.role === 'member')
          .map((m) => (
            <article className="talent-card" key={m.user_id}>
              <h3>
                {w.people.find((e) => e.user_id === m.user_id)?.display_name || 'Staff member'}
              </h3>
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
      </details>
    </section>
  );
}
