import type { Metadata } from 'next';

import { PUBLIC_ORIGIN, publicIndexingEnabled } from './discovery';

export function marketingMetadata({
  description,
  path,
  title,
}: {
  description: string;
  path: string;
  title: string;
}): Metadata {
  const canonical = new URL(path, `${PUBLIC_ORIGIN}/`).toString();
  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: publicIndexingEnabled() && path !== '/delete-account', follow: true },
    twitter: {
      card: 'summary',
      title,
      description,
      images: [`${PUBLIC_ORIGIN}/brand/tryoutflow-logo.png`],
    },
    openGraph: {
      type: 'website',
      siteName: 'TryoutFlow',
      locale: 'en_US',
      images: [{ url: `${PUBLIC_ORIGIN}/brand/tryoutflow-logo.png`, alt: 'TryoutFlow' }],
      title,
      description,
      url: canonical,
    },
  };
}
