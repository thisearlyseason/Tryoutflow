import type { OrganizationId } from '../../../lib/ids';

import type { TryoutStatus } from './lifecycle';

export type TryoutDraft = {
  id: string;
  organizationId: OrganizationId;
  seasonId: string | null;
  name: string;
  slug: string;
  sport: string;
  timezone: string;
  status: TryoutStatus;
  registrationStartsAt: Date | null;
  registrationEndsAt: Date | null;
  publishedAt: Date | null;
  finalizedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateTryoutDraft = Omit<TryoutDraft, 'id'>;
export type CreateTryoutDraftCommand = CreateTryoutDraft & { newSeasonName: string | null };

export type LifecycleTransition =
  | { kind: 'updated'; tryout: TryoutDraft }
  | { kind: 'not_found' | 'conflict' | 'invalid_transition' };

/** Application port for durable tryout configuration storage. */
export interface TryoutGateway {
  createDraft(input: CreateTryoutDraftCommand): Promise<TryoutDraft>;
  transitionLifecycle(input: {
    organizationId: OrganizationId;
    tryoutId: string;
    expectedVersion: number;
    action: 'publish' | 'finalize';
    requestedAt: Date;
  }): Promise<LifecycleTransition>;
}

export type SeasonRecord = {
  id: string;
  organizationId: OrganizationId;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
};

export type TryoutDivisionRecord = {
  id: string;
  organizationId: OrganizationId;
  tryoutId: string;
  name: string;
  sortOrder: number;
};

export type TryoutPositionRecord = {
  id: string;
  organizationId: OrganizationId;
  tryoutId: string;
  name: string;
  sortOrder: number;
};

export type TryoutSessionRecord = {
  id: string;
  organizationId: OrganizationId;
  tryoutId: string;
  divisionId: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
};

export type SessionGroupRecord = {
  id: string;
  organizationId: OrganizationId;
  tryoutId: string;
  sessionId: string;
  name: string;
  sortOrder: number;
};
