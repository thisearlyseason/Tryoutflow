import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CsvImportWizard } from '../../../src/modules/registration/ui/csv-import-wizard';

describe('CSV import wizard', () => {
  it('starts with an accessible bounded file-selection step', () => {
    render(<CsvImportWizard organizationId="a0101010-1010-4010-8010-101010101010" />);
    expect(screen.getByLabelText('CSV file')).toHaveAttribute('accept', '.csv,text/csv');
    expect(screen.getByRole('status')).toHaveTextContent('Choose a CSV file');
    expect(screen.getByText(/maximum 1 MiB and 1,000 data rows/i)).toBeInTheDocument();
  });
});
