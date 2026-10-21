import {
  flattenNavigation,
  type NavigationGroup,
} from '@/modules/organizations/components/app-navigation-model';
import type { SelectedEventOption } from '@/modules/organizations/components/selected-event';

/** Only server-supplied, already-permitted destinations can become a return link. */
export function workspaceReturnDestination(
  pathname: string,
  groups: readonly NavigationGroup[],
  events: readonly SelectedEventOption[],
): { href: string; label: string } | null {
  const items = flattenNavigation(groups);
  const event = events.find(
    ({ id, href }) => pathname.includes(`/tryouts/${id}/`) && pathname !== href,
  );
  if (event) return { href: event.href, label: `Back to ${event.name}` };
  const parent = items
    .filter(({ href }) => pathname.startsWith(`${href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (parent) return { href: parent.href, label: `Back to ${parent.label}` };
  const home = items.find(({ href }) => href.endsWith('/home'));
  return home && pathname !== home.href ? { href: home.href, label: 'Back to Home' } : null;
}
