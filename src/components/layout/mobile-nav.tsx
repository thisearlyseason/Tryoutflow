import { focusRingClassName } from '../ui/focus-ring';

export type MobileNavItem = {
  current?: boolean;
  href: string;
  label: string;
};

export type MobileNavProps = {
  items: MobileNavItem[];
};

export function MobileNav({ items }: MobileNavProps) {
  return (
    <nav
      aria-label="Primary navigation"
      className="fixed inset-x-0 bottom-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] md:hidden"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-around px-2">
        {items.map((item) => (
          <li className="flex-1" key={item.href}>
            <a
              aria-current={item.current ? 'page' : undefined}
              className={`flex min-h-[var(--target-mobile)] items-center justify-center rounded-[var(--radius-control)] px-2 text-center text-xs font-bold text-[var(--color-text)] ${focusRingClassName}`}
              href={item.href}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
