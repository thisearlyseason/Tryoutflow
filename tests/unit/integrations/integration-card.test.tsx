import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { IntegrationCard } from '../../../src/modules/integrations/ui/integration-card';

describe('IntegrationCard', () => {
  it('uses the shared administration surface and labels provider truth', () => {
    render(<IntegrationCard enabled connected providerName="The Squad" />);
    expect(screen.getByRole('article')).toHaveClass('integration-card');
    expect(screen.getByText('Demo/mock only')).toHaveAttribute('data-status', 'warning');
    expect(screen.getByText(/Connected to The Squad/)).toBeVisible();
  });
});
