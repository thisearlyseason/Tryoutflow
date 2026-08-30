import 'server-only';

import { createTeamManagementProviderRegistry } from './provider-registry';

let registry: ReturnType<typeof createTeamManagementProviderRegistry> | undefined;

export function getServerTeamManagementProviderRegistry() {
  registry ??= createTeamManagementProviderRegistry(process.env);
  return registry;
}
