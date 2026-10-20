import type { Metadata } from 'next';

import { getPublicAppOrigin } from '../../../lib/env';

export function marketingMetadata({
  description,
  path,
  title,
}: {
  description: string;
  path: string;
  title: string;
}): Metadata {
  const canonical = new URL(path, `${getPublicAppOrigin()}/`).toString();
  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'website',
      siteName: 'TryoutFlow',
      title,
      description,
      url: canonical,
    },
  };
}
