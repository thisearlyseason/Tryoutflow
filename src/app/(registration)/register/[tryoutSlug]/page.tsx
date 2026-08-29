import { RegistrationForm } from './registration-form';

export default async function PublicRegistrationPage({
  params,
}: {
  params: Promise<{ tryoutSlug: string }>;
}) {
  const { tryoutSlug } = await params;
  return <RegistrationForm tryoutSlug={tryoutSlug} />;
}
