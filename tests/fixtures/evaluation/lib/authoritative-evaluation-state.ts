type Engine = 'chromium' | 'webkit';

const state = globalThis as typeof globalThis & {
  __tryoutFlowEvaluationIdentities?: Map<string, string>;
};
const identities = (state.__tryoutFlowEvaluationIdentities ??= new Map<string, string>());

function key(registrationId: string, engine: Engine) {
  return `${registrationId}:${engine}`;
}

export function readAuthoritativeEvaluationId(registrationId: string, engine: Engine) {
  return identities.get(key(registrationId, engine));
}

export function recordAuthoritativeEvaluationId(
  registrationId: string,
  engine: Engine,
  evaluationId: string,
) {
  identities.set(key(registrationId, engine), evaluationId);
}
