'use client';

import { MessageComposer } from '../../../../src/modules/communications/ui/message-composer';

const preview = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  rosterVersionId: '10000000-0000-4000-8000-000000000002',
  rosterVersion: 7,
  kind: 'selected' as const,
  editableText: 'Thank you for taking part in this tryout.',
  recipients: [
    {
      registrationId: '10000000-0000-4000-8000-000000000003',
      recipientEmail: 'ava@example.com',
      athletePreferredName: 'Ava',
    },
    {
      registrationId: '10000000-0000-4000-8000-000000000004',
      recipientEmail: 'bea@example.com',
      athletePreferredName: 'Bea',
    },
  ],
  count: 2,
  digest: 'a'.repeat(64),
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
