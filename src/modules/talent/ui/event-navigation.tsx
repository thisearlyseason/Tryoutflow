'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';

const groups = [
  { label: 'Overview', paths: ['overview'] },
  {
    label: 'Prepare',
    paths: ['registration', 'eligibility', 'stations', 'staff', 'sessions', 'setup'],
  },
  { label: 'Run event', paths: ['live', 'coverage', 'check-in'] },
  { label: 'Make decisions', paths: ['rankings', 'scenarios', 'rosters', 'reports', 'compare'] },
  { label: 'Communicate', paths: ['operations', 'messages'] },
];
export function EventNavigation({ base, links }: { base: string; links: string[][] }) {
  const pathname = usePathname();
  const router = useRouter();
  const section = pathname.slice(base.length + 1).split('/')[0] ?? '';
  const available = groups.filter((g) => links.some(([path]) => g.paths.includes(path ?? '')));
  const current = available.find((g) => g.paths.includes(section)) ?? available[0];
  if (!current) return null;
  const activeLinks = links.filter(([path]) => current.paths.includes(path ?? ''));
  return (
    <div className="talent-event-navigation talent-no-print">
      <nav className="talent-event-groups" aria-label="Tryout workflow">
        {available.map((g) => (
          <Link
            key={g.label}
            prefetch={false}
            aria-current={g === current ? 'true' : undefined}
            href={`${base}/${links.find(([path]) => g.paths.includes(path ?? ''))![0]}`}
          >
            {g.label}
          </Link>
        ))}
      </nav>
      <nav className="talent-tabs talent-event-sections" aria-label="Tryout workspace">
        {activeLinks.map(([path, label]) => (
          <Link
            key={path}
            prefetch={false}
            aria-current={path === section ? 'page' : undefined}
            href={`${base}/${path}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <label className="talent-event-mobile">
        Go to section
        <ChevronDown size={16} aria-hidden="true" />
        <select
          aria-label="Tryout section"
          value={links.some(([p]) => p === section) ? section : ''}
          onChange={(e) => {
            const link = links.find(([p]) => p === e.target.value);
            if (link) router.push(`${base}/${link[0]}`);
          }}
        >
          <option value="" disabled>
            Select a section
          </option>
          {available.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {links
                .filter(([p]) => g.paths.includes(p ?? ''))
                .map(([p, l]) => (
                  <option key={p} value={p}>
                    {l}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
    </div>
  );
}
