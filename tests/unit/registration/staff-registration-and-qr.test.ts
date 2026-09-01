import { describe, expect, it, vi } from 'vitest';

import type { OrganizationId, UserId } from '../../../src/lib/ids';
import { issueCheckinQr } from '../../../src/modules/checkin/application/issue-checkin-qr';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import {
  createStaffRegistration,
  type StaffRegistrationGateway,
} from '../../../src/modules/registration/application/create-staff-registration';
import type { RegistrationFormSchema } from '../../../src/modules/registration/domain/form-schema';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrganizationId;
const userId = '11111111-1111-4111-8111-111111111111' as UserId;
const tryoutId = '22222222-2222-4222-8222-222222222222';
const registrationId = '33333333-3333-4333-8333-333333333333';
const emptyForm: RegistrationFormSchema = { fields: [] };
const consentForm: RegistrationFormSchema = {
  fields: [
    {
      key: 'consent',
      label: 'I consent',
      kind: 'consent',
      required: true,
      sortOrder: 0,
    },
  ],
};

function authorization(role: 'owner' | 'member'): AuthorizationContext {
  return {
    userId,
    organizationId,
    organizationRole: role,
    membershipStatus: 'active',
    assignments: [],
  };
}

describe('staff-assisted registration and QR commands', () => {
  it('rejects responses that violate the selected immutable form version before the gateway', async () => {
    const gateway: StaffRegistrationGateway = {
      create: vi.fn().mockResolvedValue({
        outcome: 'created',
        registrationId,
        athleteId: '44444444-4444-4444-8444-444444444444',
      }),
    };

    await expect(
      createStaffRegistration(
        {
          organizationId,
          tryoutId,
          divisionId: '55555555-5555-4555-8555-555555555555',
          givenName: 'Ada',
          familyName: 'Lovelace',
          birthDate: '2014-01-02',
          responses: { consent: false, position: 'Not an option' },
          idempotencyKey: '66666666-6666-4666-8666-666666666666',
        },
        { authorization: authorization('owner') },
        {
          gateway,
          form: {
            fields: [
              {
                key: 'consent',
                label: 'I consent',
                kind: 'consent',
                required: true,
                sortOrder: 0,
              },
              {
                key: 'position',
                label: 'Preferred position',
                kind: 'select',
                required: true,
                sortOrder: 1,
                options: ['Goalie', 'Skater'],
              },
            ],
          },
        },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_input' } });
    expect(gateway.create).not.toHaveBeenCalled();
  });

  it('creates a bounded manual registration with a privacy-safe idempotency digest', async () => {
    const gateway: StaffRegistrationGateway = {
      create: vi.fn().mockResolvedValue({
        outcome: 'created',
        registrationId,
        athleteId: '44444444-4444-4444-8444-444444444444',
      }),
    };

    const result = await createStaffRegistration(
      {
        organizationId,
        tryoutId,
        divisionId: '55555555-5555-4555-8555-555555555555',
        givenName: 'Ada',
        familyName: 'Lovelace',
        birthDate: '2014-01-02',
        responses: { consent: true },
        idempotencyKey: '66666666-6666-4666-8666-666666666666',
      },
      { authorization: authorization('owner') },
      { gateway, form: consentForm },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        registrationId,
        athleteId: '44444444-4444-4444-8444-444444444444',
        replayed: false,
      },
    });
    expect(gateway.create).toHaveBeenCalledWith(
      expect.objectContaining({ submissionKeyDigest: expect.stringMatching(/^[0-9a-f]{64}$/u) }),
    );
  });

  it('preserves a database idempotency conflict as an exact application result', async () => {
    const gateway: StaffRegistrationGateway = {
      create: vi.fn().mockResolvedValue({ outcome: 'idempotency_conflict' }),
    };

    await expect(
      createStaffRegistration(
        {
          organizationId,
          tryoutId,
          divisionId: '55555555-5555-4555-8555-555555555555',
          givenName: 'Ada',
          familyName: 'Lovelace',
          birthDate: '2014-01-02',
          responses: { consent: true },
          idempotencyKey: '66666666-6666-4666-8666-666666666666',
        },
        { authorization: authorization('owner') },
        { gateway, form: consentForm },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'idempotency_conflict' } });
  });

  it('supports a returning athlete without permitting mixed identity input', async () => {
    const gateway: StaffRegistrationGateway = {
      create: vi.fn().mockResolvedValue({
        outcome: 'replayed',
        registrationId,
        athleteId: '44444444-4444-4444-8444-444444444444',
      }),
    };
    const base = {
      organizationId,
      tryoutId,
      existingAthleteId: '44444444-4444-4444-8444-444444444444',
      divisionId: '55555555-5555-4555-8555-555555555555',
      responses: {},
      idempotencyKey: '66666666-6666-4666-8666-666666666666',
    };

    await expect(
      createStaffRegistration(
        base,
        { authorization: authorization('owner') },
        { gateway, form: emptyForm },
      ),
    ).resolves.toEqual(expect.objectContaining({ ok: true }));
    await expect(
      createStaffRegistration(
        { ...base, givenName: 'Mixed', familyName: 'Identity', birthDate: '2014-01-02' },
        { authorization: authorization('owner') },
        { gateway, form: emptyForm },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_input' } });
  });

  it('requires scoped check-in write permission before issuing a QR token', async () => {
    const issue = vi.fn().mockResolvedValue('a'.repeat(64));
    await expect(
      issueCheckinQr(
        { organizationId, tryoutId, registrationId },
        { authorization: authorization('member') },
        { issue },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'forbidden' } });
    expect(issue).not.toHaveBeenCalled();

    await expect(
      issueCheckinQr(
        { organizationId, tryoutId, registrationId },
        { authorization: authorization('owner') },
        { issue },
      ),
    ).resolves.toEqual({ ok: true, value: { token: 'a'.repeat(64) } });
  });

  it('rejects malformed provider tokens and unavailable adapters', async () => {
    await expect(
      issueCheckinQr(
        { organizationId, tryoutId, registrationId },
        { authorization: authorization('owner') },
        { issue: vi.fn().mockResolvedValue('raw-registration-id') },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'unavailable' } });
  });
});
