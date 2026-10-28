import Image from 'next/image';
import styles from './sport-loading.module.css';

export function SportLoading({ title = 'Getting your game plan ready.' }: { title?: string }) {
  return (
    <section className={styles.loading} role="status" aria-live="polite" aria-label={title}>
      <div className={styles.field} aria-hidden="true">
        <span />
      </div>
      <div className={styles.content}>
        <Image
          src="/brand/tryoutflow-logo.png"
          alt="TryoutFlow"
          width={88}
          height={88}
          loading="eager"
        />
        <p className={styles.eyebrow}>READY. SET. TRYOUT.</p>
        <h2 className={styles.title}>{title}</h2>
        <div className={styles.dots} aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </div>
    </section>
  );
}
