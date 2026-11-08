import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, it, expect, vi } from 'vitest';
import { RegistrationForm } from '@/app/(registration)/register/[tryoutSlug]/registration-form';
import {
  FAMILY_KEY,
  FAMILY_EPOCH,
  clearFamilyRecovery,
} from '@/modules/registration/ui/family-recovery-store';
const config = {
  organization: { name: 'QA Club' },
  tryout: {
    name: 'QA Camp',
    formVersionId: 'version1',
    divisions: [
      { id: 'd1', name: 'U15' },
      { id: 'd2', name: 'U18' },
    ],
    positions: [],
    formSchema: {
      builtInFields: [
        { key: 'givenName', label: 'First name', enabled: true, required: true, sortOrder: 0 },
        { key: 'familyName', label: 'Last name', enabled: true, required: true, sortOrder: 1 },
        {
          key: 'guardianEmail',
          label: 'Contact email',
          enabled: true,
          required: true,
          sortOrder: 2,
        },
        { key: 'birthDate', label: 'Date of birth', enabled: true, required: true, sortOrder: 3 },
        { key: 'divisionId', label: 'Division', enabled: true, required: true, sortOrder: 4 },
      ],
      fields: [
        { key: 'medical', label: 'Additional details', kind: 'text', required: true, sortOrder: 5 },
        {
          key: 'waiver',
          label: 'Participation waiver',
          kind: 'consent',
          required: true,
          sortOrder: 6,
          waiverText: 'Current participation terms.',
        },
      ],
    },
  },
};
let request: ReturnType<typeof vi.fn>;
function input(name: string) {
  return document.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
}
async function mount() {
  const v = render(<RegistrationForm tryoutSlug="camp" deterministicBotToken="qa-token" />);
  await screen.findByRole('heading', { name: 'Registration details' });
  return v;
}
async function enable() {
  await userEvent.click(screen.getByText('Keep an unfinished form temporarily'));
  await userEvent.click(screen.getByRole('button', { name: 'Enable temporary recovery' }));
}
function fill() {
  for (const [key, value] of Object.entries({
    givenName: 'Jordan',
    familyName: 'Lee',
    guardianEmail: 'alex@example.test',
    birthDate: '2012-01-01',
    divisionId: 'd1',
    medical: 'PRIVATE DETAIL',
  }))
    fireEvent.change(input(key), { target: { value } });
  fireEvent.click(input('waiver'));
}
beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  request = vi.fn(
    async (_url: string, init?: RequestInit) =>
      new Response(JSON.stringify(init?.method === 'POST' ? {} : config), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', request);
});
it('is off by default, resumes allowed details explicitly, clears omitted answers/consent and returns to first step', async () => {
  const v = await mount();
  fill();
  expect(sessionStorage.getItem(FAMILY_KEY)).toBeNull();
  await enable();
  const raw = sessionStorage.getItem(FAMILY_KEY)!;
  expect(raw).toContain('Jordan');
  expect(raw).not.toContain('2012');
  expect(raw).not.toContain('PRIVATE DETAIL');
  expect(raw).not.toContain('waiver');
  v.unmount();
  await mount();
  await screen.findByRole('button', { name: 'Resume temporary copy' });
  expect(input('givenName').value).toBe('');
  await userEvent.click(screen.getByRole('button', { name: 'Resume temporary copy' }));
  expect(input('givenName').value).toBe('Jordan');
  expect(input('guardianEmail').value).toBe('alex@example.test');
  expect(input('divisionId').value).toBe('d1');
  expect(input('birthDate').value).toBe('');
  expect(input('medical').value).toBe('');
  expect(input('waiver').checked).toBe(false);
  expect(screen.getByRole('heading', { name: 'Registration details' })).toBeVisible();
  expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByText(/Please complete or correct/)).toBeVisible();
});
it('clear form removes visible details/copy and invalidates a stale writer while retaining unrelated retry storage', async () => {
  await mount();
  await enable();
  fill();
  sessionStorage.setItem('unrelated', 'keep');
  sessionStorage.setItem('tryoutflow:registration:camp:idempotency', 'existing-retry');
  const old = localStorage.getItem(FAMILY_EPOCH);
  await userEvent.click(screen.getByRole('button', { name: 'Clear this form' }));
  expect(input('givenName').value).toBe('');
  expect(input('medical').value).toBe('');
  expect(input('waiver').checked).toBe(false);
  expect(sessionStorage.getItem(FAMILY_KEY)).toBeNull();
  expect(localStorage.getItem(FAMILY_EPOCH)).not.toBe(old);
  expect(sessionStorage.getItem('unrelated')).toBe('keep');
  expect(sessionStorage.getItem('tryoutflow:registration:camp:idempotency')).toBe('existing-retry');
  fireEvent.change(input('givenName'), { target: { value: 'After clear' } });
  expect(sessionStorage.getItem(FAMILY_KEY)).toBeNull();
});
it('handles privacy resets and another-tab epoch changes without retaining onscreen family details', async () => {
  await mount();
  await enable();
  fill();
  act(() => clearFamilyRecovery());
  expect(input('givenName').value).toBe('');
  expect(sessionStorage.getItem(FAMILY_KEY)).toBeNull();
  await enable();
  fill();
  localStorage.setItem(FAMILY_EPOCH, crypto.randomUUID());
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: FAMILY_EPOCH })));
  expect(input('guardianEmail').value).toBe('');
  expect(input('waiver').checked).toBe(false);
});
it('still permits ordinary editing when storage is denied', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw Error('denied');
  });
  await mount();
  await screen.findByText(/Temporary recovery is unavailable/);
  fireEvent.change(input('givenName'), { target: { value: 'Ordinary entry' } });
  expect(input('givenName').value).toBe('Ordinary entry');
  expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
});
it('retains on failed POST, then clears only after a confirmed successful response', async () => {
  request.mockImplementation(
    async (_url: string, init?: RequestInit) =>
      new Response(JSON.stringify(init?.method === 'POST' ? {} : config), {
        status: init?.method === 'POST' ? 503 : 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  await mount();
  await enable();
  fill();
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await userEvent.click(screen.getByRole('button', { name: 'Continue to review' }));
  await userEvent.click(screen.getByRole('button', { name: 'Submit registration' }));
  await screen.findByText(/We could not confirm/);
  expect(sessionStorage.getItem(FAMILY_KEY)).not.toBeNull();
  expect(input('givenName').value).toBe('Jordan');
  request.mockImplementation(
    async () =>
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Submit registration' }));
  await waitFor(() => expect(sessionStorage.getItem(FAMILY_KEY)).toBeNull());
});
it('blocks stale versions and unavailable saved choices before Resume', async () => {
  let v = await mount();
  await enable();
  fill();
  v.unmount();
  request.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({ ...config, tryout: { ...config.tryout, formVersionId: 'version2' } }),
        { status: 200 },
      ),
  );
  v = await mount();
  await screen.findByText(/registration form changed/);
  expect(screen.queryByRole('button', { name: 'Resume temporary copy' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Clear this form' }));
  v.unmount();
  request.mockImplementation(async () => new Response(JSON.stringify(config), { status: 200 }));
  v = await mount();
  await enable();
  fill();
  v.unmount();
  request.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          ...config,
          tryout: { ...config.tryout, divisions: [{ id: 'd2', name: 'U18' }] },
        }),
        { status: 200 },
      ),
  );
  await mount();
  await screen.findByText(/no longer available/);
  expect(screen.queryByRole('button', { name: 'Resume temporary copy' })).toBeNull();
});
it('expires the copy without wiping current onscreen entries or restarting writes', async () => {
  await mount();
  await enable();
  fill();
  const original = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(original + 30 * 60 * 1000 + 1);
  act(() => window.dispatchEvent(new Event('pageshow')));
  expect(sessionStorage.getItem(FAMILY_KEY)).toBeNull();
  expect(input('givenName').value).toBe('Jordan');
  fireEvent.change(input('givenName'), { target: { value: 'Still editing' } });
  expect(sessionStorage.getItem(FAMILY_KEY)).toBeNull();
  clock.mockRestore();
});
it('checks the privacy epoch before POST even before another-tab reset event arrives', async () => {
  await mount();
  await enable();
  fill();
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await userEvent.click(screen.getByRole('button', { name: 'Continue to review' }));
  localStorage.setItem(FAMILY_EPOCH, crypto.randomUUID());
  await userEvent.click(screen.getByRole('button', { name: 'Submit registration' }));
  expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  expect(input('givenName').value).toBe('');
  expect(input('waiver').checked).toBe(false);
});
it('unchecks and updates the consent review after a form-version conflict', async () => {
  request.mockImplementation(
    async (_url: string, init?: RequestInit) =>
      new Response(JSON.stringify(init?.method === 'POST' ? {} : config), {
        status: init?.method === 'POST' ? 409 : 200,
      }),
  );
  await mount();
  fill();
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await userEvent.click(screen.getByRole('button', { name: 'Continue to review' }));
  await userEvent.click(screen.getByRole('button', { name: 'Submit registration' }));
  await screen.findByText(/waiver or registration form has changed/);
  expect(input('waiver').checked).toBe(false);
  expect(screen.getByText('Not selected')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Submit registration' })).toBeDisabled();
});
it.each([
  ['pageshow', true],
  ['pageshow', false],
  ['visibilitychange', true],
  ['visibilitychange', false],
] as const)(
  'clears restored %s family details before delayed storage events, recovery enabled=%s',
  async (eventName, enabled) => {
    await mount();
    if (enabled) await enable();
    fill();
    localStorage.setItem(FAMILY_EPOCH, crypto.randomUUID());
    act(() => {
      (eventName === 'pageshow' ? window : document).dispatchEvent(new Event(eventName));
    });
    expect(input('givenName').value).toBe('');
    expect(input('guardianEmail').value).toBe('');
    expect(input('waiver').checked).toBe(false);
    expect(sessionStorage.getItem(FAMILY_KEY)).toBeNull();
  },
);
it('clearing after a version conflict reloads current configuration without reapplying cached linked-profile details', async () => {
  request.mockImplementation(
    async (_url: string, init?: RequestInit) =>
      new Response(JSON.stringify(init?.method === 'POST' ? {} : config), {
        status: init?.method === 'POST' ? 409 : 200,
      }),
  );
  render(
    <RegistrationForm
      tryoutSlug="camp"
      deterministicBotToken="qa-token"
      recoveryContext="linked:user:athlete"
      prefill={{ givenName: 'Jordan', familyName: 'Lee', birthDate: '2012-01-01' }}
    />,
  );
  await screen.findByRole('heading', { name: 'Registration details' });
  await enable();
  fill();
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await userEvent.click(screen.getByRole('button', { name: 'Continue to review' }));
  await userEvent.click(screen.getByRole('button', { name: 'Submit registration' }));
  await screen.findByText(/waiver or registration form has changed/);
  await userEvent.click(screen.getByRole('button', { name: 'Clear this form' }));
  await waitFor(() =>
    expect(request.mock.calls.filter(([, init]) => init?.method !== 'POST')).toHaveLength(2),
  );
  await screen.findByRole('heading', { name: 'Registration details' });
  expect(input('givenName').value).toBe('');
  expect(input('birthDate').value).toBe('');
  expect(input('waiver').checked).toBe(false);
});
