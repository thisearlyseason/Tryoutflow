import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { OrganizationNameFields } from '../../../src/modules/organizations/ui/organization-name-fields';

describe('organization name and suggested address', () => {
  it('suggests an address and preserves a deliberately edited address when the name changes', async () => {
    render(<OrganizationNameFields />);
    await userEvent.type(screen.getByLabelText(/Organization name/), 'Fictional Sports Club');
    expect(screen.getByLabelText(/Workspace address/)).toHaveValue('fictional-sports-club');
    await userEvent.clear(screen.getByLabelText(/Workspace address/));
    await userEvent.type(screen.getByLabelText(/Workspace address/), 'fictional-qa');
    await userEvent.type(screen.getByLabelText(/Organization name/), ' U14');
    expect(screen.getByLabelText(/Workspace address/)).toHaveValue('fictional-qa');
  });
});
