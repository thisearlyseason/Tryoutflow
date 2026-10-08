import { render, screen } from '@testing-library/react';
import type { Metadata } from 'next';
import type { ComponentType, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [] }) }));

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
  { path: '/', Page: HomePage, metadata: homeMetadata, heading: /great athletes/i },
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
  { path: '/demo', Page: DemoPage, metadata: demoMetadata, heading: /U15 Hockey/i },
  { path: '/privacy', Page: PrivacyPage, metadata: privacyMetadata, heading: /privacy/i },
  { path: '/terms', Page: TermsPage, metadata: termsMetadata, heading: /terms/i },
];

async function renderRoute(Page: ComponentType) {
  return render(await MarketingLayout({ children: <Page /> }));
}

function canonicalUrl(metadata: Metadata): string | null {
  const canonical = metadata.alternates?.canonical;
  if (canonical === null || canonical === undefined) return null;
  if (typeof canonical === 'string' || canonical instanceof URL) return canonical.toString();
  return canonical.url.toString();
}

describe('public marketing routes', () => {
  it.each(routes)(
    '$path renders one indexable page with its own canonical',
    async ({ Page, heading, metadata, path }) => {
      const { container } = await renderRoute(Page);

      expect(screen.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      expect(container.querySelectorAll('h1')).toHaveLength(1);
      expect(canonicalUrl(metadata)).toBe(`https://tryoutflow.test${path}`);
      expect(metadata.robots).toMatchObject({ index: true, follow: true });
    },
  );

  it('leads with the workflow and shows real, non-identifying product states', () => {
    render(<HomePage />);

    expect(screen.getByRole('heading', { name: 'Great athletes start here.' })).toBeVisible();
    expect(screen.getByRole('region', { name: /tryout day workflow/i })).toBeVisible();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('tab', { name: '01 Prepare' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('img', { name: /tryout setup review/i })).toBeVisible();
    expect(screen.getByText('Sample only · nothing is saved')).toBeVisible();
    expect(document.body).not.toHaveTextContent(
      /AI athlete selection|automatically selects|live The Squad|live Stripe/i,
    );
    expect(document.body).not.toHaveTextContent(/Ava Smith|guardian@example/i);
    expect(
      screen.getByRole('img', {
        name: 'Illustrative soccer training scene with an athlete dribbling between cones',
      }),
    ).toHaveAttribute('src');
  });

  it('supports keyboard workflow navigation and updates the screenshot and guide destination', async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    await user.click(screen.getByRole('tab', { name: '01 Prepare' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: '02 Check in' })).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: '02 Check in' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'See every step' })).toHaveAttribute(
      'href',
      '/how-to?audience=checkin',
    );
    expect(screen.getByRole('img', { name: /confirmed arrival/i })).toBeVisible();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: '04 Decide' })).toHaveFocus();
    expect(screen.getByRole('img', { name: /rankings with scores/i })).toBeVisible();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: '01 Prepare' })).toHaveFocus();
  });

  it('lets visitors explore scoring without saving an evaluation', async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await user.click(screen.getByRole('radio', { name: '5' }));
    expect(screen.getByRole('radio', { name: '5' })).toBeChecked();
    expect(screen.getByText('Standout')).toBeVisible();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: '4' })).toBeChecked();
    expect(screen.getByText('Strong')).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('renders the current USD plans with monthly, annual, and one-time prices', () => {
    render(<PricingTable />);

    for (const name of ['Pro', 'Organization', 'Single Tryout Pro']) {
      expect(screen.getByRole('heading', { name })).toBeVisible();
    }
    expect(screen.queryByRole('heading', { name: 'Free' })).not.toBeInTheDocument();
    expect(screen.getByText('Your first 7 days are free')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Try Pro free for 7 days' })).toHaveAttribute(
      'href',
      '/start?plan=pro',
    );
    expect(screen.getByText('$14.99')).toBeVisible();
    expect(screen.getByText('$49.99')).toBeVisible();
    expect(screen.getByText('$34.99')).toBeVisible();
    expect(screen.getByText(/Pro Annual · \$149\.99 USD \/ year/)).toBeVisible();
    expect(screen.getByText(/or \$499\.99 USD \/ year/)).toBeVisible();
    expect(screen.getByText('Pro Monthly · USD / month')).toBeVisible();
    expect(screen.getByText('USD / month')).toBeVisible();
    expect(screen.getByText('USD / tryout · one time')).toBeVisible();
    expect(screen.queryByText(/CAD/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('keeps public navigation semantic, keyboard-visible, and pointed at existing routes', () => {
    render(<MarketingShell>Page content</MarketingShell>);

    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'TryoutFlow' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Features' })).toHaveAttribute('href', '/features');
    expect(screen.getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '/pricing');
    expect(screen.getByRole('link', { name: 'Demo' })).toHaveAttribute('href', '/demo');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
    expect(screen.getByRole('link', { name: 'Try the demo' })).toHaveAttribute('href', '/demo');
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveClass('min-h-[var(--target-mobile)]');
      expect(link).toHaveClass('focus-visible:ring-[var(--color-focus)]');
    }
  });

  it('does not load authenticated or tenant data while rendering any public page without session cookies', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    for (const { Page } of routes) await renderRoute(Page);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('prelaunch legal drafts', () => {
  it.each([['terms', TermsPage]] as const)(
    'marks %s as a draft requiring legal approval',
    (_name, Page) => {
      render(<Page />);

      expect(screen.getByRole('status')).toHaveTextContent(/prelaunch draft/i);
      expect(screen.getByRole('status')).toHaveTextContent(/legal review and approval required/i);
      expect(document.body).toHaveTextContent(/not legal advice/i);
      expect(document.body).not.toHaveTextContent(/lorem ipsum/i);
    },
  );

  it('states the unresolved privacy decisions reviewers must close', () => {
    render(<PrivacyPage />);

    expect(screen.getByRole('heading', { name: /minor athletes/i })).toBeVisible();
    expect(screen.getByRole('heading', { name: /retention and deletion/i })).toBeVisible();
    expect(screen.getByRole('heading', { name: /who receives information/i })).toBeVisible();
    expect(document.body).toHaveTextContent(/international processing/i);
    expect(document.body).toHaveTextContent(/Canadian-only data residency is not promised/i);
    expect(document.body).toHaveTextContent(/GameDay Technologies/i);
    expect(screen.getAllByRole('link', { name: 'gamedaysportstech@gmail.com' })[0]).toHaveAttribute(
      'href',
      'mailto:gamedaysportstech@gmail.com',
    );
  });

  it('states concrete operating terms and unresolved support contacts', () => {
    render(<TermsPage />);

    expect(
      screen.getByRole('heading', { name: /organizations and authorized users/i }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: /human roster decisions/i })).toBeVisible();
    expect(screen.getByRole('heading', { name: /subscription and payment/i })).toBeVisible();
    expect(document.body).toHaveTextContent(
      /Support: GameDay Technologies, gamedaysportstech@gmail.com/i,
    );
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
