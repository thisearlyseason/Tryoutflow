import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RegistrationForm } from '../../../src/app/(registration)/register/[tryoutSlug]/registration-form';

const configuredRegistration = {
  organization: { name: 'Badlands Hockey Academy' },
  tryout: {
    name: 'U15 Fall Evaluations',
    slug: 'fall-camp',
    formVersionId: 'f1151010-1010-4010-8010-101010101010',
    divisions: [],
    positions: [],
    formSchema: {
      builtInFields: [
        {
          key: 'givenName',
          label: 'Athlete first name',
          enabled: true,
          required: true,
          sortOrder: 0,
        },
        {
          key: 'familyName',
          label: 'Athlete last name',
          enabled: true,
          required: true,
          sortOrder: 1,
        },
        {
          key: 'guardianEmail',
          label: 'Contact email',
          enabled: true,
          required: true,
          sortOrder: 2,
        },
      ],
      fields: [
        {
          key: 'team_name',
          label: 'Current team',
          kind: 'text',
          enabled: true,
          required: true,
          sortOrder: 3,
        },
        {
          key: 'waiver',
          label: 'Participation waiver',
          kind: 'consent',
          enabled: true,
          required: false,
          sortOrder: 4,
          waiverText: 'I agree to the participation terms.',
        },
      ],
    },
  },
};

function input(name: string) {
  const element = document.querySelector<HTMLInputElement>(`[name="${name}"]`);
  if (!element) throw new Error(`Missing input ${name}`);
  return element;
}

function completeFirstStep() {
  fireEvent.change(input('givenName'), { target: { value: 'Jordan' } });
  fireEvent.change(input('familyName'), { target: { value: 'Lee' } });
  fireEvent.change(input('guardianEmail'), { target: { value: 'guardian@example.test' } });
}

describe('public registration steps', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(configuredRegistration), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  });

  it('keeps configured fields mounted in saved order while moving through guided steps', async () => {
    const { container } = render(
      <RegistrationForm tryoutSlug="fall-camp" deterministicBotToken="verified-token" />,
    );

    expect(await screen.findByRole('heading', { name: 'Registration details' })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Registration progress' })).toHaveTextContent(
      'Step 1 of 3',
    );
    expect(
      Array.from(
        container.querySelectorAll<HTMLInputElement>('form [name]:not([type="hidden"])'),
      ).map((element) => element.name),
    ).toEqual(['givenName', 'familyName', 'guardianEmail', 'team_name', 'waiver']);
    expect(input('team_name')).not.toBeVisible();
    expect(input('cf-turnstile-response').closest('[hidden]')).toBeNull();

    completeFirstStep();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByRole('heading', { name: 'Additional details' })).toBeVisible();
    expect(input('givenName')).not.toBeVisible();
    expect(input('givenName')).toHaveValue('Jordan');
    fireEvent.change(input('team_name'), { target: { value: 'Badlands Selects' } });
    fireEvent.click(input('waiver'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to review' }));

    const review = screen.getByRole('region', { name: 'Registration review' });
    expect(within(review).getByText('Jordan')).toBeVisible();
    expect(within(review).getByText('Badlands Selects')).toBeVisible();
    expect(within(review).getByText('Accepted')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(input('team_name')).toBeVisible();
    expect(input('team_name')).toHaveValue('Badlands Selects');
    expect(input('waiver')).toBeChecked();
  });

  it('blocks Continue on the current step and focuses its first missing field', async () => {
    const { container } = render(
      <RegistrationForm tryoutSlug="fall-camp" deterministicBotToken="verified-token" />,
    );
    await screen.findByRole('heading', { name: 'Registration details' });

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByRole('heading', { name: 'Registration details' })).toBeVisible();
    expect(input('givenName')).toHaveFocus();
    expect(input('givenName')).toHaveAttribute('aria-invalid', 'true');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[name="team_name"]')).not.toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('returns from review to the step containing a newly missing field before submission', async () => {
    render(<RegistrationForm tryoutSlug="fall-camp" deterministicBotToken="verified-token" />);
    await screen.findByRole('heading', { name: 'Registration details' });
    completeFirstStep();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(input('team_name'), { target: { value: 'Badlands Selects' } });
    fireEvent.click(input('waiver'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to review' }));
    expect(screen.getByRole('heading', { name: 'Review registration' })).toBeVisible();

    fireEvent.change(input('givenName'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit registration' }));

    expect(screen.getByRole('heading', { name: 'Registration details' })).toBeVisible();
    expect(input('givenName')).toHaveFocus();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('moves keyboard focus to each new step heading after Continue and Back', async () => {
    const user = userEvent.setup();
    render(<RegistrationForm tryoutSlug="fall-camp" deterministicBotToken="verified-token" />);
    await screen.findByRole('heading', { name: 'Registration details' });
    completeFirstStep();

    screen.getByRole('button', { name: 'Continue' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: 'Additional details' })).toHaveFocus();

    screen.getByRole('button', { name: 'Back' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: 'Registration details' })).toHaveFocus();

    screen.getByRole('button', { name: 'Continue' }).focus();
    await user.keyboard('{Enter}');
    fireEvent.change(input('team_name'), { target: { value: 'Badlands Selects' } });
    fireEvent.click(input('waiver'));
    screen.getByRole('button', { name: 'Continue to review' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: 'Review registration' })).toHaveFocus();

    screen.getByRole('button', { name: 'Back' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: 'Additional details' })).toHaveFocus();
  });
});
