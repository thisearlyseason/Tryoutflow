import {
  connectionChallengeSchema,
  connectionResultSchema,
} from '../../modules/integrations/domain/contracts';
import {
  normalizeTeamManagementProviderError,
  type TeamManagementProvider,
} from '../../modules/integrations/domain/provider';

export async function ensureDemoMockConnection(
  provider: TeamManagementProvider,
  input: {
    organizationId: string;
    actorId: string;
    connectionId: string;
    correlationId: string;
    idempotencyKey: string;
    mockData: boolean;
  },
) {
  const context = {
    organizationId: input.organizationId,
    actorId: input.actorId,
    connectionId: input.connectionId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
  };
  try {
    await provider.verifyConnection(context);
    return;
  } catch (error) {
    const normalized = normalizeTeamManagementProviderError(error);
    if (
      normalized.code !== 'authentication_required' ||
      provider.providerKey !== 'the-squad' ||
      !input.mockData
    ) {
      throw error;
    }
  }
  const challenge = connectionChallengeSchema.parse(
    await provider.beginConnection({
      organizationId: input.organizationId,
      actorId: input.actorId,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      callbackUrl: 'https://demo-mock.tryoutflow.invalid/callback',
    }),
  );
  if (challenge.mode !== 'mock' || !challenge.mockData) {
    throw { code: 'provider_configuration', retryable: false };
  }
  const connected = connectionResultSchema.parse(
    await provider.completeConnection({
      organizationId: input.organizationId,
      actorId: input.actorId,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      challengeId: challenge.challengeId,
      callbackParameters: { mockApproval: 'approved' },
    }),
  );
  if (
    connected.connectionId !== input.connectionId ||
    connected.providerKey !== provider.providerKey ||
    !connected.mockData
  ) {
    throw { code: 'connection_invalid', retryable: false };
  }
  await provider.verifyConnection(context);
}
