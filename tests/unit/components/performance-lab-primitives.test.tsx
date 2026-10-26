import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WorkspaceState } from '../../../src/components/feedback/workspace-state';
import { PageHeader } from '../../../src/components/layout/page-header';
import { BibBadge } from '../../../src/components/ui/bib-badge';
import { Button } from '../../../src/components/ui/button';
import { FormField } from '../../../src/components/ui/form-field';
import { Input } from '../../../src/components/ui/input';
import { LinkButton } from '../../../src/components/ui/link-button';
import { Metric } from '../../../src/components/ui/metric';
import { Select } from '../../../src/components/ui/select';
import { StatusBadge } from '../../../src/components/ui/status-badge';
import { Surface } from '../../../src/components/ui/surface';
import { Textarea } from '../../../src/components/ui/textarea';

describe('Performance Lab primitives', () => {
  it('renders the complete action hierarchy with accessible names', () => {
    render(
      <>
        <Button variant="primary">Publish</Button>
        <Button variant="secondary">Preview</Button>
        <Button variant="quiet">Cancel</Button>
        <Button variant="destructive">Delete</Button>
        <LinkButton href="/tryouts" variant="secondary">
          View tryouts
        </LinkButton>
      </>,
    );

    expect(screen.getByRole('button', { name: 'Publish' })).toHaveClass('button-primary');
    expect(screen.getByRole('button', { name: 'Preview' })).toHaveClass('button-secondary');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('button-quiet');
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('button-destructive');
    expect(screen.getByRole('link', { name: 'View tryouts' })).toHaveClass('button-secondary');
  });

  it('associates field help and errors with native controls', () => {
    render(
      <FormField
        description="Shown to athletes"
        error="Name is required"
        htmlFor="tryout-name"
        label="Tryout name"
        required
      >
        {({ describedBy, invalid }) => (
          <Input
            aria-describedby={describedBy}
            aria-invalid={invalid}
            id="tryout-name"
            name="name"
          />
        )}
      </FormField>,
    );

    const input = screen.getByRole('textbox', { name: /tryout name/i });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Shown to athletes Name is required');
  });

  it('renders native selection and multiline controls at the mobile target', () => {
    render(
      <>
        <Select aria-label="Division" defaultValue="u18">
          <option value="u18">U18</option>
        </Select>
        <Textarea aria-label="Private note" />
      </>,
    );

    expect(screen.getByRole('combobox', { name: 'Division' })).toHaveClass(
      'min-h-[var(--target-mobile)]',
    );
    expect(screen.getByRole('textbox', { name: 'Private note' })).toHaveClass(
      'min-h-[calc(var(--target-mobile)*2)]',
    );
  });

  it('composes athletic identity, metrics, surfaces, headers, and explicit states', () => {
    render(
      <>
        <PageHeader
          actions={<LinkButton href="/create">Create tryout</LinkButton>}
          description="Registration closes September 30."
          eyebrow="Badlands U18"
          title="Fall evaluation"
        />
        <Surface variant="metric">
          <Metric label="Athletes" value="42" />
        </Surface>
        <BibBadge number={27} />
        <WorkspaceState
          description="Refresh to load current evidence."
          title="Rankings unavailable"
          variant="unavailable"
        />
      </>,
    );

    expect(screen.getByRole('heading', { name: 'Fall evaluation' })).toBeVisible();
    expect(screen.getByText('42')).toHaveClass('score-value');
    expect(screen.getByText('27')).toHaveAccessibleName('Tryout number 27');
    expect(screen.getByRole('alert')).toHaveTextContent('Rankings unavailable');
  });

  it('labels lifecycle, readiness, warning, unavailable, and failure states without color alone', () => {
    const statuses = [
      'draft',
      'published',
      'finalized',
      'ready',
      'warning',
      'unavailable',
      'failed',
    ];
    render(
      <>
        {statuses.map((status) => (
          <StatusBadge key={status} status={status as never} />
        ))}
      </>,
    );

    for (const label of [
      'Draft',
      'Published',
      'Finalized',
      'Ready',
      'Warning',
      'Unavailable',
      'Failed',
    ]) {
      expect(screen.getByText(label)).toBeVisible();
    }
  });
});
