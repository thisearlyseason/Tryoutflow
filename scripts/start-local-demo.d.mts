export function createLocalDemoEnvironment(
  status: {
    apiUrl: string;
    publishableKey: string;
    serviceRoleKey: string;
  },
  environment?: Record<string, string | undefined>,
): Record<string, string | undefined>;
