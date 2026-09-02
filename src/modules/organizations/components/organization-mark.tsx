'use client';

import Image from 'next/image';
import { useState } from 'react';

type OrganizationMarkProps = {
  name: string;
  logoUrl?: string;
  size?: number;
};

export function OrganizationMark({ name, logoUrl, size = 40 }: OrganizationMarkProps) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const visibleLogoUrl = logoUrl && failedUrl !== logoUrl ? logoUrl : undefined;
  const dimensions = { height: size, width: size };

  if (!visibleLogoUrl) {
    return (
      <span
        aria-label={`${name} logo fallback`}
        className="inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--color-performance)] font-[var(--font-bib)] text-xs font-black text-[#07182b]"
        role="img"
        style={dimensions}
      >
        TF
      </span>
    );
  }

  return (
    <span
      className="inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--color-surface-muted)]"
      style={dimensions}
    >
      <Image
        alt={`${name} logo`}
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
