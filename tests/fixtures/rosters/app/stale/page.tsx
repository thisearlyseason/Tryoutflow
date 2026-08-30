'use client';

import { RosterBuilder } from '../../../../../src/modules/rosters/ui/roster-builder';
import { rosterFixture } from '../page';

export default function StalePage() {
  return (
    <>
      <h1 className="mb-4">Stale roster fixture</h1>
      <h2 className="sr-only">Roster builder</h2>
      <RosterBuilder
        canEdit
        initial={rosterFixture}
        onChangeDecisions={async () => ({
          ok: false,
          code: 'conflict',
          currentVersion: 9,
        })}
        onFinalize={async () => ({ ok: false, code: 'conflict', currentVersion: 9 })}
        onMove={async () => ({ ok: false, code: 'conflict', currentVersion: 9 })}
        onRevise={async () => ({ ok: false, code: 'conflict', currentVersion: 9 })}
      />
    </>
  );
}
