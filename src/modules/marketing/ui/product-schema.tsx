import { PUBLIC_ORIGIN } from '../content/discovery';
const schema = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${PUBLIC_ORIGIN}/#publisher`,
      name: 'GameDay Technologies',
      alternateName: 'Gameday Sports',
      url: PUBLIC_ORIGIN,
      email: 'gamedaysportstech@gmail.com',
    },
    {
      '@type': 'WebSite',
      '@id': `${PUBLIC_ORIGIN}/#website`,
      name: 'TryoutFlow',
      url: PUBLIC_ORIGIN,
      inLanguage: 'en',
      publisher: { '@id': `${PUBLIC_ORIGIN}/#publisher` },
    },
    {
      '@type': 'SoftwareApplication',
      name: 'TryoutFlow',
      url: PUBLIC_ORIGIN,
      applicationCategory: 'SportsApplication',
      operatingSystem: 'Web browser',
      description:
        'Sports tryout and athlete evaluation software for coaches, clubs and associations. Organize registration, check-in, scoring, rankings and rosters.',
      publisher: { '@id': `${PUBLIC_ORIGIN}/#publisher` },
    },
  ],
};
export function ProductSchema() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, '\u003c') }}
    />
  );
}
