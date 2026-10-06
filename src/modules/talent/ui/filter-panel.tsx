'use client';

import { FeedbackButton } from '@/components/ui/button';

import { useId, useState, type ReactNode } from 'react';
import { SlidersHorizontal, ChevronDown } from 'lucide-react';
/** Desktop filters stay visible; compact screens expose them on demand. */
export function FilterPanel({
  children,
  active = false,
}: {
  children: ReactNode;
  active?: boolean;
}) {
  const [open, setOpen] = useState(active);
  const id = useId();
  return (
    <div className="talent-filter-shell">
      <FeedbackButton
        type="button"
        className="talent-filter-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
        Search & filters{active && <span className="talent-tab-count">Applied</span>}
        <ChevronDown size={16} aria-hidden="true" />
      </FeedbackButton>
      <div id={id} className="talent-filter-content" data-open={open}>
        {children}
      </div>
    </div>
  );
}
