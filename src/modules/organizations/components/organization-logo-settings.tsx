import { Button } from '../../../components/ui/button';
import { OrganizationMark } from './organization-mark';

export type OrganizationLogoSettingsStatus =
  'updated' | 'removed' | 'invalid_file' | 'too_large' | 'forbidden' | 'unavailable';

type OrganizationLogoSettingsProps = {
  organizationName: string;
  logoUrl?: string;
  canManage: boolean;
  status?: OrganizationLogoSettingsStatus;
  uploadAction: (formData: FormData) => Promise<void>;
  removeAction: (formData: FormData) => Promise<void>;
};

const statusMessages: Record<OrganizationLogoSettingsStatus, string> = {
  updated: 'Organization logo updated.',
  removed: 'Organization logo removed.',
  invalid_file: 'Choose a PNG, JPEG, or WebP image and try again.',
  too_large: 'The logo is over the encoded size limit. Try a simpler or smaller image.',
  forbidden: 'You no longer have permission to update this logo.',
  unavailable: 'Logo update is temporarily unavailable. Your current logo was kept. Try again.',
};

export function OrganizationLogoSettings({
  organizationName,
  logoUrl,
  canManage,
  status,
  uploadAction,
  removeAction,
}: OrganizationLogoSettingsProps) {
  const hasLogo = Boolean(logoUrl);
  return (
    <section aria-labelledby="organization-logo-heading" className="mt-8">
      <h2 id="organization-logo-heading">Organization logo</h2>
      <p>Use a PNG, JPEG, or WebP up to 2 MiB. A square image is recommended.</p>
      {status ? (
        <p
          className="mt-3"
          role={status === 'updated' || status === 'removed' ? 'status' : 'alert'}
        >
          {statusMessages[status]}
        </p>
      ) : null}
      <div className="mt-4 flex min-h-32 w-48 items-center justify-center overflow-hidden rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
        <OrganizationMark accessible name={organizationName} logoUrl={logoUrl} size={112} />
      </div>
      {canManage ? (
        <div className="mt-4 flex min-w-0 flex-wrap items-end gap-3">
          <form action={uploadAction} className="min-w-0 max-w-full" encType="multipart/form-data">
            <label
              className="grid min-w-0 max-w-full gap-1 font-bold"
              htmlFor="organization-logo-file"
            >
              Choose logo
              <input
                accept="image/png,image/jpeg,image/webp"
                className="min-h-11 w-full min-w-0 max-w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-normal"
                id="organization-logo-file"
                name="logo"
                required
                type="file"
              />
            </label>
            <Button className="mt-3" type="submit">
              {hasLogo ? 'Replace logo' : 'Upload logo'}
            </Button>
          </form>
          {hasLogo ? (
            <form action={removeAction}>
              <Button type="submit" variant="destructive">
                Remove logo
              </Button>
            </form>
          ) : null}
        </div>
      ) : (
        <p className="mt-4">An owner or administrator can update this logo.</p>
      )}
    </section>
  );
}
