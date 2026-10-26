import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import PlatformError from '../../../src/app/(platform)/platform/error';

describe('platform error state', () => {
  it('shows generic recovery copy and offers a keyboard-operable retry without exposing internals', () => {
    const reset = vi.fn();
    render(<PlatformError error={new Error('database password private')} reset={reset} />);

    expect(screen.getByRole('heading')).toHaveTextContent('temporarily unavailable');
    expect(document.body).not.toHaveTextContent('database password private');
    fireEvent.click(screen.getByRole('button', { name: 'Retry platform tools' }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
