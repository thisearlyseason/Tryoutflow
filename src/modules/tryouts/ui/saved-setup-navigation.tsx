'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** A confirmed server save clears recovery before this continuation is mounted. */
export function SavedSetupNavigation({ href, message }: { href: string; message: string }) {
  const router = useRouter();
  useEffect(() => {
    router.push(href);
  }, [href, router]);
  return (
    <div role="status">
      {message}{' '}
      <Link href={href} prefetch={false}>
        Continue setup
      </Link>
    </div>
  );
}
