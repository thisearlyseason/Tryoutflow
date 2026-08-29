import type { ReactNode } from 'react';

import '../../../../src/app/globals.css';

export default function EvaluationFixtureLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[var(--color-canvas)] text-[var(--color-text)]">{children}</body>
    </html>
  );
}
