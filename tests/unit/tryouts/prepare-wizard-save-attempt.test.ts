import { describe, expect, it, vi } from 'vitest';

import { prepareWizardSaveAttempt } from '../../../src/modules/tryouts/application/prepare-wizard-save-attempt';

describe('prepareWizardSaveAttempt', () => {
  it('captures bounded basics before awaiting a failed freshness read', async () => {
    const formData = new FormData();
    formData.set('name', `  ${'N'.repeat(180)}  `);
    formData.set('sport', '  Hockey  ');
    formData.set('timezone', '  America/Toronto  ');
    formData.set('registrationStartsAt', '2026-09-15T18:00');
    formData.set('registrationEndsAt', '2026-09-30T18:00');
    const loadFresh = vi.fn(async () => {
      formData.set('name', 'lost after await');
      return { data: null, error: new Error('temporarily unavailable') };
    });

    const attempt = await prepareWizardSaveAttempt('basics', formData, loadFresh);

    expect(attempt.fresh.error).toBeInstanceOf(Error);
    expect(attempt.submittedValues).toEqual({
      name: 'N'.repeat(160),
      sport: 'Hockey',
      timezone: 'America/Toronto',
      registrationStartsAt: '2026-09-15T18:00',
      registrationEndsAt: '2026-09-30T18:00',
    });
    expect(loadFresh).toHaveBeenCalledOnce();
  });

  it('does not attach basics state to another wizard step', async () => {
    const formData = new FormData();
    formData.set('name', 'U15');

    await expect(
      prepareWizardSaveAttempt('divisions', formData, async () => ({ data: {}, error: null })),
    ).resolves.toEqual({ fresh: { data: {}, error: null }, submittedValues: undefined });
  });
});
