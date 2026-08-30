import type { ReactNode } from 'react';

import '../../../../src/app/globals.css';

export const metadata = { title: 'TryoutFlow mock integration fixture' };

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="mx-auto min-h-dvh min-w-0 max-w-4xl overflow-x-clip p-4 sm:p-8">
          {children}
        </main>
      </body>
    </html>
  );
}
