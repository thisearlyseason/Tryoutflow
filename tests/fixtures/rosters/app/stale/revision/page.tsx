'use client';

import { RosterBuilder } from '../../../../../../src/modules/rosters/ui/roster-builder';
import { rosterFixture } from '../../page';

export default function StaleRevisionPage() {
  return (
    <>
      <h1 className="mb-4">Stale finalized roster fixture</h1>
      <RosterBuilder
        canEdit
        initial={{ ...rosterFixture, state: 'finalized', version: 5 }}
        onChangeDecisions={async () => ({ ok: false, code: 'invalid_state' })}
        onFinalize={async () => ({ ok: false, code: 'invalid_state' })}
        onMove={async () => ({ ok: false, code: 'invalid_state' })}
        onRevise={async () => ({ ok: false, code: 'conflict', currentVersion: 9 })}
      />
    </>
  );
}
