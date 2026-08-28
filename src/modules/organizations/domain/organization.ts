import type { OrganizationRole } from './roles';
import type { OrganizationId, UserId } from '../../../lib/ids';

export const defaultOrganizationTerminology = {
  athlete: 'Athlete',
  athletes: 'Athletes',
} as const;

export type OrganizationSettings = {
  timezone: string;
  terminology: Record<string, string>;
  sportDefaults: string[];
  tagDefaults: string[];
};

export type Organization = OrganizationSettings & {
  id: OrganizationId;
  name: string;
  slug: string;
};

export type OrganizationMembership = {
  organizationId: OrganizationId;
  userId: UserId;
  role: OrganizationRole;
};

export type CreateOrganizationRecord = Omit<Organization, 'id'>;

export type InvitationRecord = {
  id: string;
  organizationId: OrganizationId;
  email: string;
  role: Exclude<OrganizationRole, 'owner'>;
  tokenDigest: string;
  expiresAt: Date;
  createdByUserId: UserId;
};

export type InvitationAcceptance =
  | { kind: 'accepted'; organizationId: OrganizationId; organizationSlug: string }
  | { kind: 'expired' | 'wrong_email' | 'duplicate_membership' | 'invalid' };

/** This port stays in-memory/test-backed until Task 22 adds the durable email outbox adapter. */
export interface InvitationNotifier {
  enqueue(message: {
    invitationId: string;
    organizationId: OrganizationId;
    email: string;
    token: string;
    expiresAt: Date;
  }): Promise<void>;
}

export interface OrganizationGateway {
  createWithOwner(
    input: CreateOrganizationRecord,
  ): Promise<
    { organization: Organization; membership: OrganizationMembership } | { kind: 'slug_conflict' }
  >;
  createInvitation(input: InvitationRecord): Promise<{ id: string }>;
  acceptInvitation(tokenDigest: string): Promise<InvitationAcceptance>;
  updateSettings(
    input: { organizationId: OrganizationId } & Partial<OrganizationSettings>,
  ): Promise<OrganizationSettings>;
}

export function normalizeOrganizationSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function isIanaTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
