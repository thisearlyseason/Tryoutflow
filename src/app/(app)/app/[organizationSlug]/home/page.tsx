export default function OrganizationHomePage() {
  return (
    <section
      aria-labelledby="onboarding-heading"
      className="rounded-[var(--radius-card)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)]"
    >
      <p className="eyebrow">Getting started</p>
      <h2 id="onboarding-heading">Your tryout operations checklist</h2>
      <ol>
        <li>Invite your coaching staff.</li>
        <li>Confirm your terminology and time zone.</li>
        <li>Create your first tryout when you are ready.</li>
      </ol>
    </section>
  );
}
