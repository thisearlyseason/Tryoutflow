import { notFound } from 'next/navigation';
import { z } from 'zod';

import { ErrorState } from '@/components/feedback/error-state';
import { trackSupabaseWorkflowSafely } from '@/infrastructure/analytics/supabase-analytics-provider';
import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import {
  batchConfirmationSchema,
  createMessageBatch,
  loadRecipientPreview,
} from '@/modules/communications/application/create-message-batch';
import { DeliveryStatus } from '@/modules/communications/ui/delivery-status';
import { MessageComposer } from '@/modules/communications/ui/message-composer';
import { requireOrganizationRouteContext } from '@/modules/organizations/application/organization-route-context';
import { requireCapability } from '@/modules/organizations/application/require-capability';
import { createCorrelationId } from '@/modules/observability/domain/correlation-id';

const inputSchema = z
  .object({
    rosterVersionId: z.uuid(),
    kind: z.enum(['callback', 'selected', 'waitlisted', 'released']),
    editableText: z.string().trim().min(1).max(4_000),
    templateId: z.string().trim().min(1).max(100),
    expectedTemplateVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
const templateInputSchema = z
  .object({
    kind: z.enum(['callback', 'selected', 'waitlisted', 'released']),
    editableText: z.string().trim().min(1).max(4_000),
    expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
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
  const [tryoutResult, versionsResult] = await Promise.all([
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
  ]);
  if (tryoutResult.error) {
    captureOperationalError(tryoutResult.error, {
      actorId: current.userId,
      organizationId,
      tryoutId,
      operation: 'messages.load',
    });
    return (
      <ErrorState
        description="Tryout details could not be loaded. Refresh and try again."
        title="Messages temporarily unavailable"
      />
    );
  }
  const tryout = tryoutResult.data;
  const versions = versionsResult.data;
  if (!tryout) notFound();
  if (versionsResult.error) {
    captureOperationalError(versionsResult.error, {
      actorId: current.userId,
      organizationId,
      tryoutId,
      operation: 'messages.load',
    });
    return (
      <ErrorState
        title="Messages unavailable"
        description="Finalized roster snapshots could not be loaded."
      />
    );
  }
  if (!versions?.length)
    return (
      <section aria-labelledby="messages-empty">
        <h2 id="messages-empty">No finalized roster snapshots</h2>
        <p>Finalize a roster before preparing decision messages.</p>
      </section>
    );
  const authorizedVersions = (versions ?? []).filter(
    (version) =>
      requireCapability(current.authorization, 'roster:write', {
        organizationId,
        tryoutId,
        divisionId: version.division_id,
      }).ok,
  );
  if (authorizedVersions.length === 0)
    return (
      <section aria-labelledby="messages-denied">
        <h2 id="messages-denied">Messages unavailable</h2>
        <p role="alert">You do not have access to send messages for these roster scopes.</p>
      </section>
    );
  const { data: rawTemplateRows, error: templateError } = await (
    current.client as unknown as RpcClient
  ).rpc('list_communication_templates_for_notice', {
    p_organization_id: organizationId,
    p_tryout_id: tryoutId,
  });
  if (templateError) {
    captureOperationalError(templateError, {
      actorId: current.userId,
      organizationId,
      tryoutId,
      operation: 'messages.load',
    });
    return (
      <ErrorState
        description="Message templates could not be loaded. Refresh before composing."
        title="Messages temporarily unavailable"
      />
    );
  }
  const templateRows = Array.isArray(rawTemplateRows)
    ? (rawTemplateRows as Array<Record<string, unknown>>)
    : [];
  const messagesResult = await current.client
    .from('communication_messages')
    .select('id,state,created_at,protected_facts_snapshot,source_roster_version_id')
    .eq('organization_id', organizationId)
    .eq('source_kind', 'roster_decision')
    .in(
      'source_roster_version_id',
      authorizedVersions.map((version) => version.id),
    )
    .order('created_at', { ascending: false })
    .limit(50);
  if (messagesResult.error) {
    captureOperationalError(messagesResult.error, {
      actorId: current.userId,
      organizationId,
      tryoutId,
      operation: 'messages.load',
    });
    return (
      <ErrorState
        description="Delivery status could not be loaded. Refresh before composing."
        title="Messages temporarily unavailable"
      />
    );
  }
  const messages = messagesResult.data;
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
    const parsed = batchConfirmationSchema.safeParse(input);
    if (!parsed.success) return { outcome: 'invalid_input' as const };
    const confirmation = parsed.data;
    if (confirmation.organizationId !== organizationId || confirmation.tryoutId !== tryoutId)
      return { outcome: 'forbidden' as const };
    const scoped = await requireOrganizationRouteContext(organizationSlug);
    const result = await createMessageBatch(confirmation, scoped.client as unknown as RpcClient);
    if (result.outcome === 'queued' || result.outcome === 'replayed')
      await trackSupabaseWorkflowSafely(scoped.client, {
        name: 'workflow.completed',
        workflow: 'communication',
        organizationId: scoped.organization.id,
        correlationId: createCorrelationId(),
      });
    return result;
  }
  async function saveTemplateAction(input: unknown) {
    'use server';
    const parsed = templateInputSchema.safeParse(input);
    if (!parsed.success) return { outcome: 'invalid_input' as const };
    const scoped = await requireOrganizationRouteContext(organizationSlug);
    const { data, error } = await (scoped.client as unknown as RpcClient).rpc(
      'save_communication_template',
      {
        p_organization_id: scoped.organization.id,
        p_message_kind: parsed.data.kind,
        p_editable_text: parsed.data.editableText,
        p_expected_version: parsed.data.expectedVersion,
      },
    );
    if (error || !data || typeof data !== 'object') return { outcome: 'invalid_input' as const };
    const result = data as Record<string, unknown>;
    return {
      outcome: String(result.outcome),
      version: result.version ? Number(result.version) : undefined,
      templateId: result.templateId ? String(result.templateId) : undefined,
    };
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
        canSaveTemplates={
          requireCapability(current.authorization, 'membership:manage', { organizationId }).ok
        }
        templates={Object.fromEntries(
          templateRows.map((template) => [
            String(template.message_kind),
            {
              id: String(template.id),
              editableText: String(template.editable_text),
              version: Number(template.version),
            },
          ]),
        )}
        rosterVersions={authorizedVersions.map((version) => ({
          id: version.id,
          label: `Finalized revision ${version.revision_number} · version ${version.version}`,
        }))}
        previewAction={previewAction}
        sendAction={sendAction}
        saveTemplateAction={saveTemplateAction}
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
