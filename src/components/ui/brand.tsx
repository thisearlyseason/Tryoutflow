import Image from 'next/image';

/** Original TryoutFlow badge, with contrast controlled by the surrounding surface. */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand-lockup${compact ? ' brand-lockup-compact' : ''}`}>
      <Image
        alt="TryoutFlow"
        className="brand-symbol"
        src="/brand/tryoutflow-logo.png"
        width={1254}
        height={1254}
        sizes={compact ? '48px' : '96px'}
        loading="eager"
      />
    </span>
  );
}
