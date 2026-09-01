import type { AnchorHTMLAttributes } from 'react';

import { buttonClassName, type ButtonVariant } from './button';

export type LinkButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  variant?: ButtonVariant;
};

export function LinkButton({ className, href, variant = 'primary', ...props }: LinkButtonProps) {
  return <a {...props} className={buttonClassName(variant, className)} href={href} />;
}
