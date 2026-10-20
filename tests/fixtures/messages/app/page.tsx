'use client';

import { MessageComposer } from '../../../../src/modules/communications/ui/message-composer';

const preview = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  tryoutId: '10000000-0000-4000-8000-000000000005',
  divisionId: '10000000-0000-4000-8000-000000000006',
  rosterVersionId: '10000000-0000-4000-8000-000000000002',
  rosterVersion: 7,
  kind: 'selected' as const,
  templateId: 'builtin:selected',
  templateVersion: 1,
  editableText: 'Thank you for taking part in this tryout.',
  recipients: [
    {
      registrationId: '10000000-0000-4000-8000-000000000003',
      recipientEmail: 'ava@example.com',
      athletePreferredName: 'Ava',
      subject: 'Roster selection: U15 Competitive Tryout',
      text: 'Ava\n\nThank you for taking part in this tryout.',
      html: '<main>Ava</main>',
    },
    {
      registrationId: '10000000-0000-4000-8000-000000000004',
      recipientEmail: 'bea@example.com',
      athletePreferredName: 'Bea',
      subject: 'Roster selection: U15 Competitive Tryout',
      text: 'Bea\n\nThank you for taking part in this tryout.',
      html: '<main><p>Bea later-recipient HTML</p></main>',
    },
  ],
  count: 2,
  digest: 'a'.repeat(64),
  recipientDigest: 'b'.repeat(64),
  previewToken: 'c'.repeat(64),
  issuedAt: '2026-08-30T12:00:00.000Z',
  expiresAt: '2026-08-30T12:10:00.000Z',
};

export default function Page() {
  return (
    <>
      <h1 className="mb-5 text-3xl font-black">Decision messages</h1>
      <p>Current finalized decision: Selected</p>
      <MessageComposer
        rosterVersions={[
          { id: preview.rosterVersionId, label: 'Finalized revision 1 · version 7' },
        ]}
        previewAction={async (input) => {
          const request = input as { kind?: string; editableText?: string };
          if (request.kind === 'released') return { outcome: 'stale_snapshot' } as const;
          return {
            ...preview,
            kind: request.kind as typeof preview.kind,
            editableText: String(request.editableText),
          };
        }}
        sendAction={async () => ({ outcome: 'queued', queuedCount: 2 })}
      />
    </>
  );
}
