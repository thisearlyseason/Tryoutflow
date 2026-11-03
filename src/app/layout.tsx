import { NativeWorkspaceBridge } from '@/modules/identity/ui/native-workspace-bridge';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';
import './product.css';
import './sports-workspace.css';
import '@/modules/talent/ui/talent.css';
import '@/components/layout/product-workflow.css';
import './evaluator-workflow.css';
import './sport-starters.css';
import './decision-workflow.css';
import './brand-experience.css';

export const metadata: Metadata = {
  title: 'TryoutFlow',
  description: 'Run fair, organized tryouts.',
  // Public marketing pages explicitly opt in. Account and registration screens stay private.
  robots: { index: false, follow: false },
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
