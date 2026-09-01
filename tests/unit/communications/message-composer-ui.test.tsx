import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MessageComposer } from '../../../src/modules/communications/ui/message-composer';

describe('MessageComposer administration layout', () => {
  it('separates message setup from exact confirmation evidence', () => {
    render(
      <MessageComposer
        previewAction={vi.fn()}
        rosterVersions={[{ id: 'roster-1', label: 'U15 · final' }]}
        sendAction={vi.fn()}
      />,
    );
    expect(screen.getByTestId('message-setup')).toHaveClass('admin-panel');
    expect(screen.getByRole('button', { name: 'Preview exact recipients' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /queue exactly/i })).not.toBeInTheDocument();
  });
});
