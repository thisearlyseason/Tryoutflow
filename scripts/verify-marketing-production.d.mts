export function assertMarketingProductionResponse(response: {
  body: string;
  path: string;
  status: number;
}): void;

export function runMarketingProductionArtifactGate(): Promise<void>;
