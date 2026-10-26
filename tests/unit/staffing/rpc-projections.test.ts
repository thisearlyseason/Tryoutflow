import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Database } from '../../../src/infrastructure/supabase/database.types';
import { parseManageableAssignment } from '../../../src/modules/staffing/infrastructure/rpc-projections';

type AssignedRow = Database['public']['Functions']['list_assigned_athletes']['Returns'][number];
type GrantRow =
  Database['public']['Functions']['list_manageable_evaluator_assignments']['Returns'][number];

describe('staffing RPC projections', () => {
  it('keeps nullable SQL projection fields truthful in generated declarations', () => {
    expectTypeOf<AssignedRow['session_id']>().toEqualTypeOf<string | null>();
    expectTypeOf<AssignedRow['group_name']>().toEqualTypeOf<string | null>();
    expectTypeOf<AssignedRow['tryout_number']>().toEqualTypeOf<number | null>();
    expectTypeOf<GrantRow['expires_at']>().toEqualTypeOf<string | null>();
    expectTypeOf<GrantRow['division_id']>().toEqualTypeOf<string | null>();
  });

  it('accepts exact nullable scope combinations and rejects impossible ones', () => {
    const base = {
      assignment_id: '77777777-7777-4777-8777-777777777777',
      evaluator_user_id: '22222222-2222-4222-8222-222222222222',
      evaluator_name: 'Evan Evaluator',
      scope_label: 'Skills',
      expires_at: null,
    };
    expect(
      parseManageableAssignment({
        ...base,
        scope_kind: 'session',
        division_id: null,
        session_id: '55555555-5555-4555-8555-555555555555',
        group_id: null,
      }),
    ).toMatchObject({ scopeKind: 'session', expiresAt: null });
    expect(
      parseManageableAssignment({
        ...base,
        expires_at: '2026-09-05T12:00:00+00:00',
        scope_kind: 'division',
        division_id: '44444444-4444-4444-8444-444444444444',
        session_id: null,
        group_id: null,
      }),
    ).toMatchObject({ expiresAt: '2026-09-05T12:00:00+00:00' });
    expect(() =>
      parseManageableAssignment({
        ...base,
        scope_kind: 'tryout',
        division_id: '44444444-4444-4444-8444-444444444444',
        session_id: null,
        group_id: null,
      }),
    ).toThrow(/invalid staffing projection/i);
  });
});
