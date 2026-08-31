import type { Metadata } from 'next';

const fallbackOrigin = 'https://tryoutflow.example';

function publicOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) return fallbackOrigin;
  try {
    return new URL(configured).origin;
  } catch {
    return fallbackOrigin;
  }
}

export function marketingMetadata({
  description,
  path,
  title,
}: {
  description: string;
  path: string;
  title: string;
}): Metadata {
  const canonical = new URL(path, `${publicOrigin()}/`).toString();
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
