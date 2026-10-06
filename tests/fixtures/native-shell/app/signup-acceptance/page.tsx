import { SignUpForm } from '../../../../../src/modules/identity/ui/sign-up-form';
export default function Page() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1>Local synthetic signup acceptance</h1>
      <SignUpForm
        emailPlaceholder="frontend@example.invalid"
        botChallenge={<p>Local fixture: no bot/provider or account creation</p>}
      />
    </main>
  );
}
