import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RegistrationConfirmationClient } from '../../../src/app/(registration)/register/[tryoutSlug]/confirmation/registration-confirmation-client';
import { TurnstileClientChallenge } from '../../../src/modules/identity/ui/turnstile-client';

vi.mock('next/script', () => ({
  default: ({
    onError,
    onReady,
    src,
  }: {
    onError?: () => void;
    onReady?: () => void;
    src: string;
  }) => (
    <button
      data-script-src={src}
      data-testid="turnstile-script-loader"
      onClick={onReady}
      onDoubleClick={onError}
      type="button"
    >
      Load Turnstile provider
    </button>
  ),
}));

type ProviderConfiguration = {
  action: string;
  callback: (token: string) => void;
  'error-callback': () => void;
  'expired-callback': () => void;
  'timeout-callback': () => void;
  sitekey: string;
};

type TurnstileApi = {
  remove: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
};

function installProvider() {
  const configurations: ProviderConfiguration[] = [];
  const api: TurnstileApi = {
    render: vi.fn((_container: HTMLElement, configuration: ProviderConfiguration) => {
      configurations.push(configuration);
      return `widget-${configurations.length}`;
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  (window as unknown as { turnstile: TurnstileApi }).turnstile = api;
  return { api, configurations };
}

describe('explicit Turnstile client lifecycle', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    delete (window as unknown as { turnstile?: TurnstileApi }).turnstile;
    vi.unstubAllGlobals();
  });

  it('renders explicitly, resets to require a fresh token, and removes the widget on unmount', async () => {
    const { api, configurations } = installProvider();
    const onReadyChange = vi.fn();
    const view = render(
      <TurnstileClientChallenge
        action="registration_reissue"
        onReadyChange={onReadyChange}
        resetKey={0}
        siteKey="turnstile-site-key"
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Bot protection is loading');
    expect(screen.getByTestId('turnstile-script-loader')).toHaveAttribute(
      'data-script-src',
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    );
    fireEvent.click(screen.getByTestId('turnstile-script-loader'));
    await waitFor(() => expect(api.render).toHaveBeenCalledTimes(1));
    expect(api.render).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        sitekey: 'turnstile-site-key',
        action: 'registration_reissue',
        callback: expect.any(Function),
        'error-callback': expect.any(Function),
        'expired-callback': expect.any(Function),
        'timeout-callback': expect.any(Function),
      }),
    );

    act(() => configurations[0]?.callback('first-single-use-token'));
    expect(screen.getByDisplayValue('first-single-use-token')).toHaveAttribute(
      'name',
      'cf-turnstile-response',
    );
    expect(onReadyChange).toHaveBeenLastCalledWith(true);

    view.rerender(
      <TurnstileClientChallenge
        action="registration_reissue"
        onReadyChange={onReadyChange}
        resetKey={1}
        siteKey="turnstile-site-key"
      />,
    );
    await waitFor(() => expect(api.reset).toHaveBeenCalledWith('widget-1'));
    expect(screen.queryByDisplayValue('first-single-use-token')).not.toBeInTheDocument();
    expect(onReadyChange).toHaveBeenLastCalledWith(false);

    act(() => configurations[0]?.callback('fresh-single-use-token'));
    expect(screen.getByDisplayValue('fresh-single-use-token')).toBeInTheDocument();
    view.unmount();
    expect(api.remove).toHaveBeenCalledWith('widget-1');
  });

  it('fails closed when the provider lifecycle throws instead of breaking the form boundary', async () => {
    const { api } = installProvider();
    api.render.mockImplementationOnce(() => {
      throw new Error('provider render failed');
    });
    const view = render(
      <TurnstileClientChallenge
        action="registration_reissue"
        resetKey={0}
        siteKey="turnstile-site-key"
      />,
    );

    fireEvent.click(screen.getByTestId('turnstile-script-loader'));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('Bot protection could not load');

    api.render.mockImplementationOnce(() => 'widget-retry');
    fireEvent.click(screen.getByRole('button', { name: 'Retry bot protection' }));
    await waitFor(() => expect(api.render).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    api.reset.mockImplementationOnce(() => {
      throw new Error('provider reset failed');
    });
    view.rerender(
      <TurnstileClientChallenge
        action="registration_reissue"
        resetKey={1}
        siteKey="turnstile-site-key"
      />,
    );
    await screen.findByRole('alert');

    api.remove.mockImplementationOnce(() => {
      throw new Error('provider remove failed');
    });
    expect(() => view.unmount()).not.toThrow();
  });

  it('explicitly mounts the reissue widget after confirmation removal and resets after failure', async () => {
    const { api, configurations } = installProvider();
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'invalid' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'invalid' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', request);
    window.history.replaceState(
      {},
      '',
      `/register/browser-camp/confirmation?token=${'a'.repeat(64)}`,
    );
    const user = userEvent.setup();

    render(<RegistrationConfirmationClient botSiteKey="turnstile-site-key" />);
    await screen.findByRole('button', { name: 'Confirm registration' });
    expect(screen.getByRole('button', { name: 'Confirm registration' })).toBeDisabled();
    fireEvent.click(screen.getByTestId('turnstile-script-loader'));
    await waitFor(() => expect(configurations[0]?.action).toBe('registration_confirmation'));
    act(() => configurations[0]?.callback('confirmation-token'));
    expect(screen.getByRole('button', { name: 'Confirm registration' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Confirm registration' }));

    await screen.findByRole('heading', { name: 'Request another confirmation code' });
    expect(api.remove).toHaveBeenCalledWith('widget-1');
    expect(screen.getByRole('button', { name: 'Get a new confirmation code' })).toBeDisabled();
    fireEvent.click(screen.getByTestId('turnstile-script-loader'));
    await waitFor(() => expect(configurations[1]?.action).toBe('registration_reissue'));
    act(() => configurations[1]?.callback('reissue-token'));
    await user.type(screen.getByLabelText('Guardian email'), 'guardian@example.com');
    await user.click(screen.getByRole('button', { name: 'Get a new confirmation code' }));

    await waitFor(() => expect(api.reset).toHaveBeenCalledWith('widget-2'));
    expect(screen.getByRole('button', { name: 'Get a new confirmation code' })).toBeDisabled();
    expect(request).toHaveBeenLastCalledWith(
      '/api/public/registrations/confirmation/reissue',
      expect.objectContaining({ body: expect.stringContaining('reissue-token') }),
    );
  });
});
