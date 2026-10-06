import Link from 'next/link';
import type { ReactNode } from 'react';
export default function Local({ children }: { children: ReactNode }) {
  return (
    <>
      <nav aria-label="Synthetic fixture navigation" className="flex flex-wrap gap-4 p-3">
        <Link href="/app/local/home">Fixture home</Link>
        <Link href="/app/local/setup/basics">Setup</Link>
        <Link href="/app/local/evaluate/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee">Evaluation</Link>
        <Link href="/app/local/charts">Charts</Link>
        <Link href="/app/local/rankings">Rankings</Link>
        <Link href="/app/local/exports">Exports</Link>
      </nav>
      {children}
    </>
  );
}
