import type { MetadataRoute } from 'next';
import {
  DISCOVERY_PATHS,
  PUBLIC_ORIGIN,
  publicIndexingEnabled,
} from '@/modules/marketing/content/discovery';
export default function sitemap(): MetadataRoute.Sitemap {
  // Omit lastModified rather than inventing a fresh date on every build.
  return publicIndexingEnabled()
    ? DISCOVERY_PATHS.map((path) => ({ url: new URL(path, PUBLIC_ORIGIN).href }))
    : [];
}
