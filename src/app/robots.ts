import type { MetadataRoute } from 'next';
import { PUBLIC_ORIGIN, publicIndexingEnabled } from '@/modules/marketing/content/discovery';
export default function robots(): MetadataRoute.Robots {
  // Allow crawling of noindex pages. Authentication remains the privacy boundary.
  // No training-specific policy is added or changed here.
  return {
    rules: { userAgent: '*', allow: '/' },
    ...(publicIndexingEnabled() ? { sitemap: `${PUBLIC_ORIGIN}/sitemap.xml` } : {}),
  };
}
