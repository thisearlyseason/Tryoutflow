import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  CsvImportError,
  escapeSpreadsheetFormula,
  parseAthleteCsv,
} from '../../../src/modules/registration/application/parse-athlete-csv';
import { previewAthleteImport } from '../../../src/modules/registration/application/preview-athlete-import';
import { commitAthleteImport } from '../../../src/modules/registration/application/commit-athlete-import';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';

const organizationId = 'a0101010-1010-4010-8010-101010101010';
const actor: AuthorizationContext = {
  userId: '10101010-1010-4010-8010-101010101010' as AuthorizationContext['userId'],
  organizationId: organizationId as AuthorizationContext['organizationId'],
  organizationRole: 'administrator',
  membershipStatus: 'active',
  assignments: [],
};
const mapping = {
  givenName: 'First Name',
  familyName: 'Last Name',
  birthDate: 'Birth Date',
  guardianName: 'Guardian Name',
  guardianEmail: 'Guardian Email',
  guardianPhone: 'Guardian Phone',
} as const;

describe('athlete CSV parsing', () => {
  it('requires an explicit, unique mapping to known columns', () => {
    const csv = 'First,Last,DOB\nAva,Smith,2013-05-01';
    expect(() => parseAthleteCsv(csv, { givenName: 'First' } as never)).toThrow(/mapping/i);
    expect(() =>
      parseAthleteCsv(csv, {
        givenName: 'First',
        familyName: 'Missing',
        birthDate: 'DOB',
      }),
    ).toThrow(/unknown column/i);
    expect(() =>
      parseAthleteCsv(csv, {
        givenName: 'First',
        familyName: 'First',
        birthDate: 'DOB',
      }),
    ).toThrow(/more than once/i);
  });

  it('rejects ambiguous and bounded-input violations', () => {
    expect(() =>
      parseAthleteCsv('Name,name,DOB\nAva,Smith,2013-05-01', {
        givenName: 'Name',
        familyName: 'name',
        birthDate: 'DOB',
      }),
    ).toThrow(/duplicate header/i);
    expect(() =>
      parseAthleteCsv(`First,Last,DOB\n${'A'.repeat(501)},Smith,2013-05-01`, {
        givenName: 'First',
        familyName: 'Last',
        birthDate: 'DOB',
      }),
    ).toThrow(/cell/i);
    expect(() => parseAthleteCsv('x'.repeat(1_048_577), mapping)).toThrow(CsvImportError);
  });

  it('neutralizes spreadsheet formulas without interpreting them', () => {
    expect(escapeSpreadsheetFormula('=HYPERLINK("https://bad")')).toBe(
      '\'=HYPERLINK("https://bad")',
    );
    expect(escapeSpreadsheetFormula(' Ava')).toBe(' Ava');
  });
});

describe('two-stage athlete import', () => {
  it('previews valid, duplicate-candidate, and invalid fixture rows deterministically', async () => {
    const csv = readFileSync('tests/fixtures/athletes/valid-and-invalid.csv', 'utf8');
    const savePreview = vi.fn(async (preview) => ({ ...preview, id: 'preview-1' }));
    const preview = await previewAthleteImport(
      { organizationId, content: csv, mapping, actor },
      {
        findExistingAthletes: async () => [],
        savePreview,
      },
    );
    expect(preview.rows).toMatchObject([
      { row: 2, status: 'valid' },
      { row: 3, status: 'duplicate_candidate' },
      { row: 4, status: 'invalid', errors: ['birth_date_invalid'] },
    ]);
    expect(preview.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(savePreview).toHaveBeenCalledOnce();
  });

  it('does not expose parsed PII when authorization fails', async () => {
    const denied = { ...actor, organizationRole: 'member' as const };
    const findExistingAthletes = vi.fn();
    await expect(
      previewAthleteImport(
        { organizationId, content: 'First,Last,DOB\nAva,Smith,2013-05-01', mapping, actor: denied },
        { findExistingAthletes, savePreview: vi.fn() },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(findExistingAthletes).not.toHaveBeenCalled();
  });

  it('commits selected valid rows through an idempotent authorized gateway', async () => {
    const gateway = {
      commit: vi.fn(async () => ({ outcome: 'committed' as const, athleteIds: ['athlete-1'] })),
    };
    const request = { organizationId, previewId: 'preview-1', selectedRows: [2], actor };
    await expect(commitAthleteImport(request, gateway)).resolves.toEqual({
      outcome: 'committed',
      athleteIds: ['athlete-1'],
    });
    await expect(commitAthleteImport(request, gateway)).resolves.toEqual({
      outcome: 'committed',
      athleteIds: ['athlete-1'],
    });
    expect(gateway.commit).toHaveBeenCalledTimes(2);
  });

  it('rejects unauthorized, duplicate, empty, and oversized selections before persistence', async () => {
    const commit = vi.fn();
    await expect(
      commitAthleteImport(
        {
          organizationId,
          previewId: 'preview-1',
          selectedRows: [2],
          actor: { ...actor, organizationRole: 'member' },
        },
        { commit },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    for (const selectedRows of [[], [2, 2], Array.from({ length: 501 }, (_, index) => index + 2)]) {
      await expect(
        commitAthleteImport(
          { organizationId, previewId: 'preview-1', selectedRows, actor },
          { commit },
        ),
      ).rejects.toBeDefined();
    }
    expect(commit).not.toHaveBeenCalled();
  });
});
