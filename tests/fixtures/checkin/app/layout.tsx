import type { ReactNode } from 'react';

import '../../../../src/app/globals.css';

export default function FixtureLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
