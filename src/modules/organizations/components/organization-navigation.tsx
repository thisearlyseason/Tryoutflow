import Link from 'next/link';

import type { AuthorizationContext } from '../application/capabilities';

export function OrganizationNavigation({
  authorization,
  organizationSlug,
}: {
  authorization: AuthorizationContext;
  organizationSlug: string;
}) {
  const managesOrganization =
    authorization.organizationRole === 'owner' ||
    authorization.organizationRole === 'administrator';
  const staffedTryouts = [
    ...new Set(
      authorization.assignments
        .filter((assignment) => assignment.role === 'director')
        .map((assignment) => assignment.scope.tryoutId),
    ),
  ];
  const rankedTryouts = [
    ...new Set(
      authorization.assignments
        .filter((assignment) => assignment.role === 'director' || assignment.role === 'reviewer')
        .map((assignment) => assignment.scope.tryoutId),
    ),
  ];
  const rosteredTryouts = rankedTryouts;
  const evaluates = authorization.assignments.some((assignment) => assignment.role === 'evaluator');
  const evaluatorLinks = evaluates
    ? ([['Evaluate', `/app/${organizationSlug}/evaluate`]] as string[][])
    : [];
  const links = managesOrganization
    ? [
        ['Home', `/app/${organizationSlug}/home`],
        ['Tryouts', `/app/${organizationSlug}/tryouts`],
        ['Athletes', `/app/${organizationSlug}/athletes`],
        ['Reports', `/app/${organizationSlug}/reports`],
        ...evaluatorLinks,
        ['Evaluators', `/app/${organizationSlug}/evaluators`],
        ['Members', `/app/${organizationSlug}/organization/members`],
        ['Integrations', `/app/${organizationSlug}/organization/integrations`],
        ['Settings', `/app/${organizationSlug}/organization/settings`],
        ...(authorization.organizationRole === 'owner'
          ? [['Billing', `/app/${organizationSlug}/organization/billing`]]
          : []),
      ]
    : [
        ...evaluatorLinks,
        ...staffedTryouts.map((tryoutId, index) => [
          staffedTryouts.length === 1 ? 'Staff' : `Staff ${index + 1}`,
          `/app/${organizationSlug}/tryouts/${tryoutId}/staff`,
          `Staff for tryout ${tryoutId}`,
        ]),
        ...rankedTryouts.map((tryoutId, index) => [
          rankedTryouts.length === 1 ? 'Rankings' : `Rankings ${index + 1}`,
          `/app/${organizationSlug}/tryouts/${tryoutId}/rankings`,
          `Rankings for tryout ${tryoutId}`,
        ]),
        ...rosteredTryouts.map((tryoutId, index) => [
          rosteredTryouts.length === 1 ? 'Rosters' : `Rosters ${index + 1}`,
          `/app/${organizationSlug}/tryouts/${tryoutId}/rosters`,
          `Rosters for tryout ${tryoutId}`,
        ]),
        ...staffedTryouts.map((tryoutId, index) => [
          staffedTryouts.length === 1 ? 'Reports' : `Reports ${index + 1}`,
          `/app/${organizationSlug}/tryouts/${tryoutId}/reports`,
          `Reports for tryout ${tryoutId}`,
        ]),
        ...staffedTryouts.map((tryoutId, index) => [
          staffedTryouts.length === 1 ? 'Live' : `Live ${index + 1}`,
          `/app/${organizationSlug}/tryouts/${tryoutId}/live`,
          `Live dashboard for tryout ${tryoutId}`,
        ]),
      ];

  return (
    <nav
      aria-label="Organization navigation"
      className="flex flex-wrap gap-x-4 gap-y-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    >
      {links.map(([label, href, accessibleLabel]) => (
        <Link
          aria-label={accessibleLabel}
          className="inline-flex min-h-11 items-center"
          href={href!}
          key={href}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
