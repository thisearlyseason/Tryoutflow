import { describe, expect, it } from 'vitest';

import { parseAssignedAthleteRows } from '../../../src/modules/staffing/infrastructure/supabase-assigned-athlete-gateway';

const validRow = {
  registration_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  division_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  session_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  group_id: null,
  display_name: 'Athlete 123ABC',
  division_name: 'U13',
  session_name: 'Morning',
  group_name: null,
  tryout_number: 42,
  identity_mode: 'blind',
};

describe('assigned athlete Supabase projection', () => {
  it('maps the complete blind-safe projection without adding identity fields', () => {
    expect(parseAssignedAthleteRows([validRow])).toEqual([
      {
        registrationId: validRow.registration_id,
        divisionId: validRow.division_id,
        sessionId: validRow.session_id,
        groupId: null,
        displayName: 'Athlete 123ABC',
        divisionName: 'U13',
        sessionName: 'Morning',
        groupName: null,
        tryoutNumber: 42,
        identityMode: 'blind',
      },
    ]);
  });

  it('rejects a malformed or expanded identity-mode projection', () => {
    expect(() =>
      parseAssignedAthleteRows([{ ...validRow, identity_mode: 'hidden-full-name' }]),
    ).toThrow('Invalid assigned-athlete projection');
    expect(() =>
      parseAssignedAthleteRows([{ ...validRow, guardian_email: 'private@example.test' }]),
    ).toThrow('Invalid assigned-athlete projection');
  });
});
