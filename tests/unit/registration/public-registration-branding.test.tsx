import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RegistrationForm } from '../../../src/app/(registration)/register/[tryoutSlug]/registration-form';

const configuration = {
  organization: {
    name: 'Badlands Hockey Academy',
    logoUrl: '/api/organizations/badlands-hockey-academy/logo',
  },
  tryout: {
    name: 'U15 Fall Evaluations',
    slug: 'fall-camp',
    formSchema: { fields: [] },
    divisions: [],
    positions: [],
  },
};

describe('public registration branding', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(configuration), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  });

  it('renders the published organization identity before the tryout name', async () => {
    render(<RegistrationForm tryoutSlug="fall-camp" deterministicBotToken="verified-token" />);

    const organizationName = await screen.findByText('Badlands Hockey Academy');
    const tryoutHeading = screen.getByRole('heading', {
      name: 'Register for U15 Fall Evaluations',
    });
    const mark = screen.getByRole('img', { name: 'Badlands Hockey Academy logo' });

    expect(mark).toHaveAttribute(
      'src',
      expect.stringContaining('/api/organizations/badlands-hockey-academy/logo'),
    );
    expect(
      organizationName.compareDocumentPosition(tryoutHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('replaces an unavailable public logo with the TF mark without retrying it', async () => {
    render(<RegistrationForm tryoutSlug="fall-camp" deterministicBotToken="verified-token" />);

    const mark = await screen.findByRole('img', { name: 'Badlands Hockey Academy logo' });
    fireEvent.error(mark);

    expect(
      screen.getByRole('img', { name: 'Badlands Hockey Academy logo fallback' }),
    ).toHaveTextContent('TF');
    expect(screen.queryByRole('img', { name: 'Badlands Hockey Academy logo' })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('renders the TF mark immediately when the organization has no logo URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...configuration,
          organization: { name: configuration.organization.name },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    render(<RegistrationForm tryoutSlug="fall-camp" deterministicBotToken="verified-token" />);

    expect(
      await screen.findByRole('img', { name: 'Badlands Hockey Academy logo fallback' }),
    ).toHaveTextContent('TF');
    expect(screen.queryByRole('img', { name: 'Badlands Hockey Academy logo' })).toBeNull();
  });
});
