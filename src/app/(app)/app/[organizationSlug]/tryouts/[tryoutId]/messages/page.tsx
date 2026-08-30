import { notFound } from 'next/navigation';
import { z } from 'zod';

import { ErrorState } from '@/components/feedback/error-state';
import {
  bindBatchConfirmation,
  createMessageBatch,
  loadRecipientPreview,
  type BatchConfirmation,
} from '@/modules/communications/application/create-message-batch';
import { DeliveryStatus } from '@/modules/communications/ui/delivery-status';
import { MessageComposer } from '@/modules/communications/ui/message-composer';
import { requireOrganizationRouteContext } from '@/modules/organizations/application/organization-route-context';
import { requireCapability } from '@/modules/organizations/application/require-capability';

const inputSchema = z
  .object({
    rosterVersionId: z.uuid(),
    kind: z.enum(['callback', 'selected', 'waitlisted', 'released']),
    editableText: z.string().trim().min(1).max(4_000),
  })
  .strict();

type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export default async function MessagesPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; tryoutId: string }>;
}) {
  const { organizationSlug, tryoutId } = await params;
  if (!z.uuid().safeParse(tryoutId).success) notFound();
  const current = await requireOrganizationRouteContext(organizationSlug);
  const organizationId = current.organization.id;
  const [{ data: tryout }, { data: versions, error: versionsError }, { data: messages }] =
    await Promise.all([
      current.client
        .from('tryouts')
        .select('id,name')
        .eq('organization_id', organizationId)
        .eq('id', tryoutId)
        .maybeSingle(),
      current.client
        .from('roster_versions')
        .select('id,division_id,revision_number,version')
        .eq('organization_id', organizationId)
        .eq('tryout_id', tryoutId)
        .eq('state', 'finalized')
        .order('revision_number', { ascending: false }),
      current.client
        .from('communication_messages')
        .select('id,state,created_at,protected_facts_snapshot')
        .eq('organization_id', organizationId)
        .eq('source_kind', 'roster_decision')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
  if (!tryout) notFound();
  if (versionsError)
    return (
      <ErrorState
        title="Messages unavailable"
        description="Finalized roster snapshots could not be loaded."
      />
    );
  const authorizedVersions = (versions ?? []).filter(
    (version) =>
      requireCapability(current.authorization, 'roster:write', {
        organizationId,
        tryoutId,
        divisionId: version.division_id,
      }).ok,
  );
  if (authorizedVersions.length === 0) notFound();
  async function previewAction(input: unknown) {
    'use server';
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return { outcome: 'invalid_input' as const };
    const scoped = await requireOrganizationRouteContext(organizationSlug);
    const { data: roster } = await scoped.client
      .from('roster_versions')
      .select('tryout_id,division_id')
      .eq('organization_id', scoped.organization.id)
      .eq('id', parsed.data.rosterVersionId)
      .maybeSingle();
    if (
      !roster ||
      roster.tryout_id !== tryoutId ||
      !requireCapability(scoped.authorization, 'roster:write', {
        organizationId: scoped.organization.id,
        tryoutId,
        divisionId: roster.division_id,
      }).ok
    )
      return { outcome: 'forbidden' as const };
    return loadRecipientPreview(
      { organizationId: scoped.organization.id, ...parsed.data },
      scoped.client as unknown as RpcClient,
    );
  }

  async function sendAction(input: unknown) {
    'use server';
    if (!input || typeof input !== 'object') return { outcome: 'invalid_input' as const };
    const confirmation = input as BatchConfirmation;
    const scoped = await requireOrganizationRouteContext(organizationSlug);
    const { data: roster } = await scoped.client
      .from('roster_versions')
      .select('tryout_id,division_id')
      .eq('organization_id', scoped.organization.id)
      .eq('id', confirmation.rosterVersionId)
      .maybeSingle();
    if (
      !roster ||
      roster.tryout_id !== tryoutId ||
      !requireCapability(scoped.authorization, 'roster:write', {
        organizationId: scoped.organization.id,
        tryoutId,
        divisionId: roster.division_id,
      }).ok
    )
      return { outcome: 'forbidden' as const };
    return createMessageBatch(
      bindBatchConfirmation(confirmation),
      scoped.client as unknown as RpcClient,
    );
  }

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-6 sm:px-6">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          {tryout.name}
        </p>
        <h1 className="text-3xl font-black">Messages</h1>
      </header>
      <MessageComposer
        rosterVersions={authorizedVersions.map((version) => ({
          id: version.id,
          label: `Finalized revision ${version.revision_number} · version ${version.version}`,
        }))}
        previewAction={previewAction}
        sendAction={sendAction}
      />
      <section aria-labelledby="delivery-heading">
        <h2 id="delivery-heading" className="text-2xl font-bold">
          Delivery status
        </h2>
        {messages?.length ? (
          <ul className="mt-4 grid gap-3">
            {messages.map((message) => {
              const facts = message.protected_facts_snapshot as Record<string, unknown>;
              return (
                <li
                  key={message.id}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-3 border-b py-3"
                >
                  <span>{String(facts.athlete_preferred_name ?? 'Operational message')}</span>
                  <DeliveryStatus state={message.state} />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-[var(--color-text-muted)]">
            No decision messages have been queued.
          </p>
        )}
      </section>
    </main>
  );
}
