'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';

export const eventWorkflowStages = [
  {
    label: 'Setup',
    paths: ['overview', 'setup', 'registration', 'eligibility', 'sessions', 'stations', 'staff'],
  },
  { label: 'Run Tryout', paths: ['live', 'coverage', 'check-in'] },
  { label: 'Review Results', paths: ['rankings', 'compare', 'scenarios', 'rosters'] },
  { label: 'Share Results', paths: ['reports', 'operations', 'messages'] },
];
const groups = eventWorkflowStages;
export function EventNavigation({
  base,
  links: suppliedLinks,
}: {
  base: string;
  links: string[][];
}) {
  const links = groups.flatMap((group) =>
    group.paths.flatMap((segment) =>
      suppliedLinks.filter(([path]) => path?.split('/')[0] === segment),
    ),
  );
  const pathname = usePathname();
  const router = useRouter();
  const section = pathname.slice(base.length + 1).split('/')[0] ?? '';
  const available = groups.filter((g) =>
    links.some(([path]) => g.paths.some((p) => p === (path ?? '').split('/')[0])),
  );
  const current = available.find((g) => g.paths.includes(section)) ?? available[0];
  if (!current) return null;
  const activeLinks = links.filter(([path]) =>
    current.paths.some((p) => p === (path ?? '').split('/')[0]),
  );
  return (
    <div className="talent-event-navigation talent-no-print">
      <nav className="talent-event-groups" aria-label="Tryout workflow">
        {available.map((g) => (
          <Link
            key={g.label}
            prefetch={false}
            aria-current={g === current ? 'true' : undefined}
            href={`${base}/${links.find(([path]) => g.paths.some((p) => p === (path ?? '').split('/')[0]))![0]}`}
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
            aria-current={path?.split('/')[0] === section ? 'page' : undefined}
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
          value={links.find(([p]) => p?.split('/')[0] === section)?.[0] ?? ''}
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
                .filter(([p]) => g.paths.some((segment) => segment === (p ?? '').split('/')[0]))
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
