import Link from 'next/link';
import { Brand } from '@/components/ui/brand';

export function ProductBrandBar({
  label = 'Your workspace',
  homeHref,
}: {
  label?: string;
  homeHref?: string;
}) {
  const identity = (
    <>
      <Brand compact />
      <div>
        <p>TryoutFlow</p>
        <span>{label}</span>
      </div>
    </>
  );
  return (
    <header className="product-brandbar brand-on-dark">
      {homeHref ? (
        <Link
          className="product-brandbar-home"
          href={homeHref}
          prefetch={false}
          aria-label="TryoutFlow home"
        >
          {identity}
        </Link>
      ) : (
        identity
      )}
    </header>
  );
}
