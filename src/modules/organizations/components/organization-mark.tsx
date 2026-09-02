'use client';

import Image from 'next/image';
import { useState } from 'react';

type OrganizationMarkProps = {
  name: string;
  logoUrl?: string;
  size?: number;
  accessible?: boolean;
};

export function OrganizationMark({
  name,
  logoUrl,
  size = 40,
  accessible = false,
}: OrganizationMarkProps) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const visibleLogoUrl = logoUrl && failedUrl !== logoUrl ? logoUrl : undefined;
  const dimensions = { height: size, width: size };
  const accessibleLabel = accessible ? `${name} logo` : undefined;

  if (!visibleLogoUrl) {
    return (
      <span
        aria-hidden={accessible ? undefined : true}
        aria-label={accessibleLabel}
        className="inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--color-performance)] font-[var(--font-bib)] text-xs font-black text-[#07182b]"
        role={accessible ? 'img' : undefined}
        style={dimensions}
      >
        TF
      </span>
    );
  }

  return (
    <span
      aria-hidden={accessible ? undefined : true}
      className="inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--color-surface-muted)]"
      style={dimensions}
    >
      <Image
        alt={accessibleLabel ?? ''}
        aria-hidden={accessible ? undefined : true}
        className="h-full w-full object-contain"
        height={size}
        onError={() => setFailedUrl(visibleLogoUrl)}
        src={visibleLogoUrl}
        unoptimized
        width={size}
      />
    </span>
  );
}
