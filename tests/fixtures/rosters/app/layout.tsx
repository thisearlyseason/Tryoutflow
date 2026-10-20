import type { ReactNode } from 'react';

import '../../../../src/app/globals.css';

export const metadata = { title: 'TryoutFlow roster fixture' };

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="mx-auto min-h-dvh min-w-0 max-w-7xl overflow-x-clip p-4">{children}</main>
      </body>
    </html>
  );
}
