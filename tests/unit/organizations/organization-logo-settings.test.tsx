import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OrganizationLogoSettings } from '../../../src/modules/organizations/components/organization-logo-settings';

const uploadAction = vi.fn(async (_formData: FormData) => undefined);
const removeAction = vi.fn(async (_formData: FormData) => undefined);

describe('OrganizationLogoSettings', () => {
  it('shows a safe fallback and an explicit constrained upload form', () => {
    render(
      <OrganizationLogoSettings
        canManage
        hasLogo={false}
        organizationName="Badlands Hockey Academy"
        organizationSlug="badlands-hockey-academy"
        removeAction={removeAction}
        uploadAction={uploadAction}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Organization logo' })).toBeVisible();
    expect(screen.getByLabelText('Badlands Hockey Academy logo fallback')).toHaveTextContent('TF');
    expect(screen.getByText(/PNG, JPEG, or WebP up to 2 MiB/i)).toBeVisible();
    expect(screen.getByText(/square image is recommended/i)).toBeVisible();
    const input = screen.getByLabelText('Choose logo');
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('name', 'logo');
    expect(input).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp');
    expect(input).toBeRequired();
    const form = input.closest('form');
    expect(form).toHaveAttribute('enctype', 'multipart/form-data');
    expect(within(form!).getByRole('button', { name: 'Upload logo' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Remove logo' })).not.toBeInTheDocument();
  });

  it('shows the current preview with separate replace and remove actions', () => {
    render(
      <OrganizationLogoSettings
        canManage
        hasLogo
        organizationName="Badlands Hockey Academy"
        organizationSlug="badlands-hockey-academy"
        removeAction={removeAction}
        uploadAction={uploadAction}
      />,
    );

    expect(screen.getByRole('img', { name: 'Badlands Hockey Academy logo' })).toHaveAttribute(
      'src',
      expect.stringContaining('/api/organizations/badlands-hockey-academy/logo'),
    );
    const replace = screen.getByRole('button', { name: 'Replace logo' });
    const remove = screen.getByRole('button', { name: 'Remove logo' });
    expect(replace.closest('form')).toHaveAttribute('enctype', 'multipart/form-data');
    expect(remove.closest('form')).not.toBe(replace.closest('form'));
  });

  it('replaces a failed current preview with the reusable TF fallback', () => {
    render(
      <OrganizationLogoSettings
        canManage
        hasLogo
        organizationName="Badlands Hockey Academy"
        organizationSlug="badlands-hockey-academy"
        removeAction={removeAction}
        uploadAction={uploadAction}
      />,
    );

    fireEvent.error(screen.getByRole('img', { name: 'Badlands Hockey Academy logo' }));

    expect(
      screen.getByRole('img', { name: 'Badlands Hockey Academy logo fallback' }),
    ).toHaveTextContent('TF');
    expect(screen.queryByRole('img', { name: 'Badlands Hockey Academy logo' })).toBeNull();
  });

  it('does not render mutation controls for a member without organization-update capability', () => {
    render(
      <OrganizationLogoSettings
        canManage={false}
        hasLogo
        organizationName="Badlands Hockey Academy"
        organizationSlug="badlands-hockey-academy"
        removeAction={removeAction}
        uploadAction={uploadAction}
      />,
    );

    expect(screen.getByRole('img', { name: 'Badlands Hockey Academy logo' })).toBeVisible();
    expect(screen.getByText(/owner or administrator can update this logo/i)).toBeVisible();
    expect(screen.queryByLabelText('Choose logo')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([
    ['invalid_file', /choose a PNG, JPEG, or WebP image and try again/i],
    ['too_large', /try a simpler or smaller image/i],
    ['forbidden', /no longer have permission to update this logo/i],
    ['unavailable', /current logo was kept.*try again/i],
  ] as const)('shows safe actionable %s feedback', (status, message) => {
    render(
      <OrganizationLogoSettings
        canManage
        hasLogo
        organizationName="Badlands Hockey Academy"
        organizationSlug="badlands-hockey-academy"
        removeAction={removeAction}
        status={status}
        uploadAction={uploadAction}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(message);
  });
});
