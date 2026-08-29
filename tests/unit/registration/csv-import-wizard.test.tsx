import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CsvImportWizard } from '../../../src/modules/registration/ui/csv-import-wizard';

describe('CSV import wizard', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('starts with an accessible bounded file-selection step', () => {
    render(<CsvImportWizard organizationId="a0101010-1010-4010-8010-101010101010" />);
    expect(screen.getByLabelText('CSV file')).toHaveAttribute('accept', '.csv,text/csv');
    expect(screen.getByRole('status')).toHaveTextContent('Choose a CSV file');
    expect(screen.getByText(/maximum 1 MiB and 500 data rows/i)).toBeInTheDocument();
  });

  it('prevents one CSV column from being mapped to multiple fields', async () => {
    const user = userEvent.setup();
    render(<CsvImportWizard organizationId="a0101010-1010-4010-8010-101010101010" />);
    const file = new File(['First,Last,DOB\nAva,Smith,2013-05-01'], 'athletes.csv', {
      type: 'text/csv',
    });
    await user.upload(screen.getByLabelText('CSV file'), file);
    await user.selectOptions(screen.getByLabelText(/Given name/), 'First');
    expect(
      screen.getByLabelText(/Family name/).querySelector('option[value="First"]'),
    ).toBeDisabled();
  });

  it('reviews and confirms the full bounded 500-row batch with replay feedback', async () => {
    const rows = Array.from({ length: 500 }, (_, index) => ({
      row: index + 2,
      status: 'valid' as const,
      errors: [],
      athlete: { givenName: `Athlete ${index}`, familyName: 'Smith', birthDate: '2013-05-01' },
      duplicateCandidateIds: [],
    }));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            preview: {
              id: 'preview-500',
              organizationId: 'a0101010-1010-4010-8010-101010101010',
              contentHash: 'a'.repeat(64),
              mapping: { givenName: 'First', familyName: 'Last', birthDate: 'DOB' },
              rows,
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ result: { outcome: 'replayed', athleteIds: rows.map(String) } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<CsvImportWizard organizationId="a0101010-1010-4010-8010-101010101010" />);
    await user.upload(
      screen.getByLabelText('CSV file'),
      new File(['First,Last,DOB\nAva,Smith,2013-05-01'], 'athletes.csv', { type: 'text/csv' }),
    );
    await user.selectOptions(screen.getByLabelText(/Given name/), 'First');
    await user.selectOptions(screen.getByLabelText(/Family name/), 'Last');
    await user.selectOptions(screen.getByLabelText(/Birth date/), 'DOB');
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    expect(await screen.findByText('500 of 500 valid rows selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm import' }));
    expect(await screen.findByRole('status')).toHaveTextContent('already completed (500 athletes)');
  });

  it('reloads persisted conflicts and can commit rows after duplicate review', async () => {
    const original = {
      id: 'preview-resume',
      organizationId: 'a0101010-1010-4010-8010-101010101010',
      contentHash: 'a'.repeat(64),
      mapping: { givenName: 'First', familyName: 'Last', birthDate: 'DOB' },
      rows: [
        {
          row: 2,
          status: 'valid' as const,
          errors: [],
          athlete: { givenName: 'Ava', familyName: 'Smith', birthDate: '2013-05-01' },
          duplicateCandidateIds: [],
        },
      ],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const persisted = {
      ...original,
      rows: [
        original.rows[0],
        {
          row: 3,
          status: 'valid' as const,
          errors: [],
          athlete: { givenName: 'Ava', familyName: 'Smith', birthDate: '2013-05-01' },
          duplicateCandidateIds: ['preview-row:2'],
        },
      ],
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { outcome: 'invalid_selection', athleteIds: [] } }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ preview: persisted }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ result: { outcome: 'committed', athleteIds: ['one', 'two'] } }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<CsvImportWizard organizationId={original.organizationId} initialPreview={original} />);
    await user.click(screen.getByRole('button', { name: 'Confirm import' }));
    expect(
      await screen.findByText(/preview changed.*review the current rows/i),
    ).toBeInTheDocument();
    expect(screen.getByText('2 of 2 valid rows selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm import' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Imported 2 athletes');
    expect(fetch.mock.calls[1]?.[1]?.body).toContain('load_preview');
  });
});
