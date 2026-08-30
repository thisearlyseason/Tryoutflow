import Link from 'next/link';

export function RosterExportLink({
  href,
  rosterState,
  authorized,
}: Readonly<{ href: string; rosterState: string; authorized: boolean }>) {
  if (!authorized || rosterState !== 'finalized') return null;
  return (
    <Link
      href={href}
      className="mb-5 inline-flex min-h-11 items-center rounded-xl bg-blue-700 px-5 py-3 font-bold text-white"
    >
      Export finalized roster
    </Link>
  );
}
