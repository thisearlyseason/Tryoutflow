import type { ReactNode } from 'react';

export type AppShellProps = {
  children: ReactNode;
  navigation?: ReactNode;
};

export function AppShell({ children, navigation }: AppShellProps) {
  return (
    <div className="min-h-dvh bg-[var(--color-canvas)] text-[var(--color-text)]">
      <main className="mx-auto w-full max-w-7xl px-4 py-6 pb-24 sm:px-6 lg:px-8 lg:pb-6">
        {children}
      </main>
      {navigation}
    </div>
  );
}
