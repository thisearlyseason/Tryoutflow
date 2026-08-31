import type { ReactNode } from 'react';

import { MarketingShell } from '../../components/layout/marketing-shell';

export default function MarketingLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <MarketingShell>{children}</MarketingShell>;
}
