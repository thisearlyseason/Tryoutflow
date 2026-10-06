import { NativeWorkspaceBridge } from '@/modules/identity/ui/native-workspace-bridge';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';
import './product.css';
import './sports-workspace.css';
import '@/modules/talent/ui/talent.css';

export const metadata: Metadata = {
  title: 'TryoutFlow',
  description: 'Run fair, organized tryouts.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <NativeWorkspaceBridge />
        {children}
      </body>
    </html>
  );
}
