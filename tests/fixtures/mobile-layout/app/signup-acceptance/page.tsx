import { SignUpForm } from '../../../../../src/modules/identity/ui/sign-up-form';
import { getBotChallengeConfiguration } from '../../../../../src/modules/identity/ui/bot-challenge';
export default function Page() {
  // This fixture never mounts a provider; only the existing exact automated-test boundary may issue a token.
  const { deterministicToken } = getBotChallengeConfiguration();
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1>Local synthetic signup acceptance</h1>
      <p>Local fixture: no bot/provider or account creation</p>
      <SignUpForm
        emailPlaceholder="frontend@example.invalid"
        deterministicToken={deterministicToken}
      />
    </main>
  );
}
