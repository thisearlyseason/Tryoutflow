export function assertMarketingProductionResponse(response: {
  body: string;
  path: string;
  status: number;
}): void;

export function runMarketingProductionArtifactGate(): Promise<void>;

export function startOwnedServer(options: {
  arguments_: string[];
  command: string;
  environment: NodeJS.ProcessEnv;
}): Promise<{ baseUrl: string; child: import('node:child_process').ChildProcess; port: number }>;

export function stopOwnedServer(child: import('node:child_process').ChildProcess): Promise<void>;
