import type { ReactNode } from 'react';
import { headers } from 'next/headers';

import { MobileNav } from '../../../../src/components/layout/mobile-nav';

import '../../../../src/app/globals.css';
import '../../../../src/app/product.css';
import '../../../../src/app/sports-workspace.css';

export const metadata = { title: 'TryoutFlow evaluator scoring' };

export default async function EvaluationFixtureLayout({ children }: { children: ReactNode }) {
  const navigation = (await headers()).get('x-tryoutflow-fixture-navigation') === 'mobile';
  return (
    <html lang="en">
      <body className="bg-[var(--color-canvas)] text-[var(--color-text)]">
        {navigation ? (
          <div className="app-frame">
            <MobileNav
              groups={[
                {
                  id: 'evaluation',
                  label: 'Evaluation',
                  items: [
                    {
                      href: '/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                      label: 'Evaluate',
                      icon: 'evaluate',
                    },
                    {
                      href: '/cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                      label: 'Athletes',
                      icon: 'athletes',
                    },
                  ],
                },
              ]}
              organization={{ name: 'Local evaluation fixture', slug: 'local-evaluation' }}
              pathname="/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
              roleLabel="Evaluator"
            />
            <div className="app-main">{children}</div>
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
