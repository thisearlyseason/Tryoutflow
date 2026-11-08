import type { NavigationGroup } from '@/modules/organizations/components/app-navigation-model';

/** Use the same role precedence for desktop and mobile guides. */
export function workspaceGuideAudience(roleLabel: string, groups: readonly NavigationGroup[]) {
  const roles = roleLabel.split(' · ');
  if (roles.some((role) => ['Owner', 'Administrator', 'Director'].includes(role))) return 'coaches';
  if (roles.includes('Evaluator')) return 'evaluators';
  if (roles.includes('Check-in')) return 'checkin';
  if (roles.includes('Reviewer')) return 'reviewers';
  return groups.some((group) => group.items.some((item) => item.href.endsWith('/scouting')))
    ? 'scouting'
    : 'coaches';
}

/** Guide query parameters are untrusted: accept canonical workspace paths only. */
export function workspaceGuideReturnPath(value: string | null | undefined) {
  if (!value || value.length > 2048) return null;
  if (value === '/participant' || value === '/participant/account') return value;
  return /^\/app\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[A-Za-z0-9_-]+)*\/?$/u.test(value) ? value : null;
}
