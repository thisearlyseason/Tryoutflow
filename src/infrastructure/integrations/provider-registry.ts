import 'server-only';

import type { TeamManagementProvider } from '../../modules/integrations/domain/provider';
import { MockTheSquadProvider } from './mock-the-squad-provider';

export type TeamManagementProviderDescriptor = Readonly<{
  providerKey: 'the-squad';
  displayName: 'The Squad (demo/mock)';
  mockData: true;
}>;

export class TeamManagementProviderRegistryError extends Error {
  readonly code: 'unknown_provider' | 'provider_disabled';

  constructor(code: 'unknown_provider' | 'provider_disabled') {
    super(code);
    this.name = 'TeamManagementProviderRegistryError';
    this.code = code;
  }
}

export function createTeamManagementProviderRegistry(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const enabled = environment.ENABLE_MOCK_THE_SQUAD_PROVIDER === 'true';
  const fixture =
    environment.MOCK_THE_SQUAD_FIXTURE === 'partial-failure' ? 'partial-failure' : 'success';
  const mockProvider = enabled
    ? new MockTheSquadProvider({
        fixture,
        dynamicRosterFixture: environment.MOCK_THE_SQUAD_DYNAMIC_ROSTER === 'true',
      })
    : null;
  return Object.freeze({
    get(providerKey: string): TeamManagementProvider {
      if (providerKey !== 'the-squad') {
        throw new TeamManagementProviderRegistryError('unknown_provider');
      }
      if (!mockProvider) throw new TeamManagementProviderRegistryError('provider_disabled');
      return mockProvider;
    },
    list(): TeamManagementProviderDescriptor[] {
      if (!enabled) return [];
      return [
        Object.freeze({
          providerKey: 'the-squad',
          displayName: 'The Squad (demo/mock)',
          mockData: true,
        }),
      ];
    },
  });
}
