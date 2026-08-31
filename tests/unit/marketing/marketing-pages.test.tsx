import { render, screen } from '@testing-library/react';
import type { Metadata } from 'next';
import type { ComponentType, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import MarketingLayout from '../../../src/app/(marketing)/layout';
import HomePage, { metadata as homeMetadata } from '../../../src/app/(marketing)/page';
import DemoPage, { metadata as demoMetadata } from '../../../src/app/(marketing)/demo/page';
import FeaturesPage, {
  metadata as featuresMetadata,
} from '../../../src/app/(marketing)/features/page';
import AssociationsPage, {
  metadata as associationsMetadata,
} from '../../../src/app/(marketing)/for/associations/page';
import ClubsPage, { metadata as clubsMetadata } from '../../../src/app/(marketing)/for/clubs/page';
import TeamsPage, { metadata as teamsMetadata } from '../../../src/app/(marketing)/for/teams/page';
import PricingPage, {
  metadata as pricingMetadata,
} from '../../../src/app/(marketing)/pricing/page';
import PrivacyPage, {
  metadata as privacyMetadata,
} from '../../../src/app/(marketing)/privacy/page';
import TermsPage, { metadata as termsMetadata } from '../../../src/app/(marketing)/terms/page';
import { MarketingShell } from '../../../src/components/layout/marketing-shell';
import { ProductProof } from '../../../src/modules/marketing/ui/product-proof';
import { PricingTable } from '../../../src/modules/marketing/ui/pricing-table';

type RouteExpectation = Readonly<{
  path: string;
  Page: ComponentType;
  metadata: Metadata;
  heading: RegExp;
}>;

const routes: readonly RouteExpectation[] = [
  { path: '/', Page: HomePage, metadata: homeMetadata, heading: /stop running tryouts/i },
  { path: '/features', Page: FeaturesPage, metadata: featuresMetadata, heading: /one workflow/i },
  { path: '/for/teams', Page: TeamsPage, metadata: teamsMetadata, heading: /one team/i },
  { path: '/for/clubs', Page: ClubsPage, metadata: clubsMetadata, heading: /every team/i },
  {
    path: '/for/associations',
    Page: AssociationsPage,
    metadata: associationsMetadata,
    heading: /association/i,
  },
  { path: '/pricing', Page: PricingPage, metadata: pricingMetadata, heading: /pricing/i },
  { path: '/demo', Page: DemoPage, metadata: demoMetadata, heading: /product walkthrough/i },
  { path: '/privacy', Page: PrivacyPage, metadata: privacyMetadata, heading: /privacy/i },
  { path: '/terms', Page: TermsPage, metadata: termsMetadata, heading: /terms/i },
];

function renderRoute(Page: ComponentType) {
  return render(
    <MarketingLayout>
      <Page />
    </MarketingLayout>,
  );
}

function canonicalPath(metadata: Metadata): string | null {
  const canonical = metadata.alternates?.canonical;
  if (canonical === null || canonical === undefined) return null;
  if (typeof canonical === 'string' || canonical instanceof URL) return new URL(canonical).pathname;
  return new URL(canonical.url).pathname;
}

describe('public marketing routes', () => {
  it.each(routes)(
    '$path renders one indexable page with its own canonical',
    ({ Page, heading, metadata, path }) => {
      const { container } = renderRoute(Page);

      expect(screen.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      expect(container.querySelectorAll('h1')).toHaveLength(1);
      expect(canonicalPath(metadata)).toBe(path);
      expect(metadata.robots).toMatchObject({ index: true, follow: true });
    },
  );

  it('leads with the workflow and shows real, non-identifying product states', () => {
    render(<HomePage />);

    expect(
      screen.getByRole('heading', { name: 'Stop running tryouts with spreadsheets' }),
    ).toBeVisible();
    expect(screen.getByRole('region', { name: /tryout day workflow/i })).toBeVisible();
    for (const state of [
      'Registration open',
      'Checked in',
      'Saved on device',
      'Rank 2 (tie)',
      'Draft roster',
      'Delivery queued',
    ]) {
      expect(screen.getByText(state)).toBeVisible();
    }
    expect(document.body).not.toHaveTextContent(
      /AI athlete selection|automatically selects|live The Squad|live Stripe/i,
    );
    expect(document.body).not.toHaveTextContent(/Ava Smith|guardian@example/i);
    expect(document.querySelector('img')).not.toBeInTheDocument();
  });

  it('renders pricing from the centralized CAD monthly catalog', () => {
    render(<PricingTable />);

    expect(screen.getByRole('heading', { name: 'Team' })).toBeVisible();
    expect(screen.getByText('$49')).toBeVisible();
    expect(screen.getByText('$129')).toBeVisible();
    expect(screen.getByText('$249')).toBeVisible();
    expect(screen.getAllByText('CAD / month')).toHaveLength(3);
    expect(screen.getAllByRole('link', { name: /start with/i })).toHaveLength(3);
  });

  it('keeps public navigation semantic, keyboard-visible, and pointed at existing routes', () => {
    render(<MarketingShell>Page content</MarketingShell>);

    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'TryoutFlow' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Features' })).toHaveAttribute('href', '/features');
    expect(screen.getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '/pricing');
    expect(screen.getByRole('link', { name: 'Demo' })).toHaveAttribute('href', '/demo');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
    expect(screen.getByRole('link', { name: 'Start a tryout' })).toHaveAttribute('href', '/start');
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveClass('min-h-[var(--target-mobile)]');
      expect(link).toHaveClass('focus-visible:ring-[var(--color-focus)]');
    }
  });

  it('does not load authenticated or tenant data while rendering any public page', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    for (const { Page } of routes) renderRoute(Page);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('prelaunch legal drafts', () => {
  it.each([
    ['privacy', PrivacyPage],
    ['terms', TermsPage],
  ] as const)('marks %s as a draft requiring legal approval', (_name, Page) => {
    render(<Page />);

    expect(screen.getByRole('status')).toHaveTextContent(/prelaunch draft/i);
    expect(screen.getByRole('status')).toHaveTextContent(/legal review and approval required/i);
    expect(document.body).toHaveTextContent(/not legal advice/i);
    expect(document.body).not.toHaveTextContent(/lorem ipsum/i);
  });

  it('states the unresolved privacy decisions reviewers must close', () => {
    render(<PrivacyPage />);

    expect(screen.getByRole('heading', { name: /children and minor athletes/i })).toBeVisible();
    expect(
      screen.getByRole('heading', { name: /retention, deletion, and correction/i }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: /service providers and subprocessors/i }),
    ).toBeVisible();
    expect(document.body).toHaveTextContent(/cross-border processing/i);
    expect(document.body).toHaveTextContent(/Canadian-only data residency is not promised/i);
    expect(document.body).toHaveTextContent(/privacy contact: to be confirmed before launch/i);
  });

  it('states concrete operating terms and unresolved support contacts', () => {
    render(<TermsPage />);

    expect(
      screen.getByRole('heading', { name: /organizations and authorized users/i }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: /human roster decisions/i })).toBeVisible();
    expect(screen.getByRole('heading', { name: /subscription and payment/i })).toBeVisible();
    expect(document.body).toHaveTextContent(/support contact: to be confirmed before launch/i);
  });
});

describe('product proof components', () => {
  it('uses semantic HTML and CSS rather than a stock screenshot dependency', () => {
    const { container } = render(<ProductProof />);

    expect(screen.getByRole('region', { name: /tryout day workflow/i })).toBeVisible();
    expect(screen.getByRole('table', { name: /ranking preview/i })).toBeVisible();
    expect(container.querySelector('img, picture, video, canvas')).not.toBeInTheDocument();
  });
});
