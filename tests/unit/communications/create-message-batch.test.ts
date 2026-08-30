import { describe, expect, it, vi } from 'vitest';

import {
  createMessageBatch,
  loadRecipientPreview,
} from '../../../src/modules/communications/application/create-message-batch';

const ids = {
  organization: '33333333-3333-4333-8333-333333333333',
  tryout: '44444444-4444-4444-8444-444444444444',
  division: '55555555-5555-4555-8555-555555555555',
  roster: '66666666-6666-4666-8666-666666666666',
  registration: '77777777-7777-4777-8777-777777777777',
  batch: '88888888-8888-4888-8888-888888888888',
};
const preview = {
  outcome: 'ok',
  organizationId: ids.organization,
  tryoutId: ids.tryout,
  divisionId: ids.division,
  rosterVersionId: ids.roster,
  rosterVersion: 9,
  kind: 'selected',
  templateId: 'builtin:selected',
  templateVersion: 1,
  editableText: 'Welcome.',
  count: 1,
  digest: 'a'.repeat(64),
  recipientDigest: 'b'.repeat(64),
  previewToken: 'c'.repeat(64),
  issuedAt: '2026-08-30T12:00:00.000Z',
  expiresAt: '2026-08-30T12:10:00.000Z',
  recipients: [
    {
      registrationId: ids.registration,
      recipientEmail: 'one@example.com',
      athletePreferredName: 'Ava',
      subject: 'Roster selection: U15',
      text: 'Exact text',
      html: '<main>Exact text</main>',
    },
  ],
};

describe('decision message batch proof', () => {
  it('accepts the database authoritative rendered preview and sends only its capability', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: preview, error: null });
    const loaded = await loadRecipientPreview(
      {
        organizationId: ids.organization,
        rosterVersionId: ids.roster,
        kind: 'selected',
        editableText: 'Welcome.',
        templateId: 'builtin:selected',
        expectedTemplateVersion: 1,
      },
      { rpc },
    );
    expect(loaded).toMatchObject({ digest: 'a'.repeat(64), recipients: [{ text: 'Exact text' }] });
    expect(rpc).toHaveBeenCalledWith('preview_decision_message_batch_v2', {
      p_organization_id: ids.organization,
      p_roster_version_id: ids.roster,
      p_decision: 'selected',
      p_editable_text: 'Welcome.',
      p_template_id: 'builtin:selected',
      p_expected_template_version: 1,
    });
    rpc.mockResolvedValueOnce({
      data: { outcome: 'queued', batch_id: ids.batch, queued_count: 1 },
      error: null,
    });
    await expect(
      createMessageBatch(
        {
          organizationId: ids.organization,
          tryoutId: ids.tryout,
          divisionId: ids.division,
          rosterVersionId: ids.roster,
          digest: 'a'.repeat(64),
          previewToken: 'c'.repeat(64),
          confirmation: 'SEND EXACT BATCH',
        },
        { rpc },
      ),
    ).resolves.toEqual({
      outcome: 'queued',
      batchId: ids.batch,
      queuedCount: 1,
    });
    expect(rpc).toHaveBeenLastCalledWith('create_decision_message_batch_v2', {
      p_organization_id: ids.organization,
      p_tryout_id: ids.tryout,
      p_division_id: ids.division,
      p_roster_version_id: ids.roster,
      p_preview_token: 'c'.repeat(64),
      p_preview_digest: 'a'.repeat(64),
      p_confirmation: 'SEND EXACT BATCH',
    });
  });

  it('maps malformed actions to invalid_input without calling the database', async () => {
    const rpc = vi.fn();
    await expect(
      createMessageBatch({ confirmation: 'SEND EXACT BATCH', extra: true }, { rpc }),
    ).resolves.toEqual({ outcome: 'invalid_input' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
