import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RegistrationConfirmationPage from '../../../src/app/(registration)/register/[tryoutSlug]/confirmation/page';

describe('registration confirmation page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/register/fall-camp/confirmation');
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('falls back to unknown when browser storage access is denied', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    render(<RegistrationConfirmationPage />);
    expect(
      await screen.findByText(/No confirmation code is available in this browser/i),
    ).toBeInTheDocument();
  });

  it('hydrates direct navigation as pending or unknown rather than successful', async () => {
    render(<RegistrationConfirmationPage />);
    expect(screen.queryByText('Your registration is confirmed.')).not.toBeInTheDocument();
    expect(
      await screen.findByText(/No confirmation code is available in this browser/i),
    ).toBeInTheDocument();
  });

  it('persists only non-sensitive confirmed state for a safe reload', async () => {
    window.localStorage.setItem('tryoutflow:registration:fall-camp:confirmed', 'true');
    render(<RegistrationConfirmationPage />);
    expect(await screen.findByText('Your registration is confirmed.')).toBeInTheDocument();
    expect(window.sessionStorage.getItem('tryoutflow:registration:confirmation')).toBeNull();
  });

  it('treats a new one-time token as pending even if an older registration was confirmed', async () => {
    window.localStorage.setItem('tryoutflow:registration:fall-camp:confirmed', 'true');
    window.sessionStorage.setItem(
      'tryoutflow:registration:confirmation',
      JSON.stringify({ token: 'c'.repeat(64), tryoutSlug: 'fall-camp' }),
    );
    render(<RegistrationConfirmationPage />);
    expect(await screen.findByText('c'.repeat(64))).toBeInTheDocument();
    expect(screen.queryByText('Your registration is confirmed.')).not.toBeInTheDocument();
  });

  it('offers guardian-proven reissue after expiry and replaces the one-time token', async () => {
    window.sessionStorage.setItem(
      'tryoutflow:registration:confirmation',
      JSON.stringify({ token: 'a'.repeat(64), tryoutSlug: 'fall-camp' }),
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'expired' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ status: 'reissued', manualConfirmationToken: 'b'.repeat(64) }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<RegistrationConfirmationPage />);
    await user.click(await screen.findByRole('button', { name: 'Confirm registration' }));
    expect(await screen.findByText(/expired/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Guardian email'), 'guardian@example.com');
    await user.click(screen.getByRole('button', { name: 'Get a new confirmation code' }));
    expect(await screen.findByText('b'.repeat(64))).toBeInTheDocument();
    await waitFor(() =>
      expect(
        JSON.parse(window.sessionStorage.getItem('tryoutflow:registration:confirmation') ?? '{}'),
      ).toEqual({ token: 'b'.repeat(64), tryoutSlug: 'fall-camp' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/public/registrations/confirmation/reissue',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
