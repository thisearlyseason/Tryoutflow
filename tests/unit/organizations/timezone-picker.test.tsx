import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TimezonePicker } from '../../../src/modules/organizations/ui/timezone-picker';

function detect(timeZone: string) {
  const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
    this: Intl.DateTimeFormat,
  ) {
    return { ...resolvedOptions.call(this), timeZone };
  });
}

afterEach(() => vi.restoreAllMocks());

describe('organization timezone detection', () => {
  it.each(['UTC', 'America/Edmonton'])(
    'submits detected %s even if the catalog omits it',
    (zone) => {
      detect(zone);
      vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue(['Europe/London']);
      render(
        <form>
          <TimezonePicker />
        </form>,
      );
      const input = screen.getByRole('combobox');
      expect(input).toHaveValue(zone);
      expect(new FormData(input.closest('form')!).get('timezone')).toBe(zone);
      expect(document.querySelector(`option[value="${zone}"]`)).not.toBeNull();
    },
  );

  it('keeps a user-selected timezone instead of replacing it with detection', async () => {
    detect('UTC');
    render(<TimezonePicker />);
    const input = screen.getByRole('combobox');
    await userEvent.clear(input);
    await userEvent.type(input, 'America/Edmonton');
    expect(input).toHaveValue('America/Edmonton');
  });

  it('keeps the picker usable when the timezone catalog is unavailable', () => {
    detect('UTC');
    vi.spyOn(Intl, 'supportedValuesOf').mockImplementation(() => {
      throw new Error('unavailable');
    });
    render(<TimezonePicker />);
    expect(screen.getByRole('combobox')).toHaveValue('UTC');
    expect(document.querySelector('option[value="America/Edmonton"]')).not.toBeNull();
  });

  it('leaves invalid detection empty rather than submitting a catalog example', () => {
    detect('Not/AZone');
    render(
      <form>
        <TimezonePicker />
      </form>,
    );
    const input = screen.getByRole('combobox');
    expect(input).toHaveValue('');
    expect(new FormData(input.closest('form')!).get('timezone')).toBe('');
  });
});
