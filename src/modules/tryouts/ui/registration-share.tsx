import QRCode from 'qrcode';

import { canonicalRegistrationUrl } from '../application/publish-tryout';

export async function RegistrationShare({
  origin,
  publicSlug,
}: {
  origin: string;
  publicSlug: string;
}) {
  const url = canonicalRegistrationUrl(origin, publicSlug);
  const qrCode = await QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 256,
  });
  return (
    <section
      aria-labelledby="registration-share-heading"
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    >
      <h2 id="registration-share-heading">Registration link</h2>
      <p className="mt-2 break-all text-sm text-[var(--color-text-muted)]">{url}</p>
      <a
        className="mt-3 inline-flex min-h-[var(--target-mobile)] items-center font-bold text-[var(--color-primary)] underline"
        href={url}
      >
        Open public registration
      </a>
      {/* QR codes are deterministic data URLs, so Next image optimization cannot improve them. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={`QR code for ${url}`}
        className="mt-4 h-48 w-48"
        height={192}
        src={qrCode}
        width={192}
      />
    </section>
  );
}
