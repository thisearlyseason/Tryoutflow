type Engine = 'chromium' | 'webkit';

const state = globalThis as typeof globalThis & {
  __tryoutFlowEvaluationIdentities?: Map<string, string>;
};
const identities = (state.__tryoutFlowEvaluationIdentities ??= new Map<string, string>());

function key(registrationId: string, engine: Engine, runId: string) {
  return `${runId}:${registrationId}:${engine}`;
}

export function readAuthoritativeEvaluationId(
  registrationId: string,
  engine: Engine,
  runId: string,
) {
  return identities.get(key(registrationId, engine, runId));
}

export function recordAuthoritativeEvaluationId(
  registrationId: string,
  engine: Engine,
  runId: string,
  evaluationId: string,
) {
  identities.set(key(registrationId, engine, runId), evaluationId);
}
