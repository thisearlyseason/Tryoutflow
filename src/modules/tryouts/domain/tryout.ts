import type { OrganizationId } from '../../../lib/ids';

import type { TryoutStatus } from './lifecycle';

export type TryoutDraft = {
  id: string;
  organizationId: OrganizationId;
  seasonId: string | null;
  name: string;
  sport: string;
  timezone: string;
  status: TryoutStatus;
  registrationStartsAt: Date | null;
  registrationEndsAt: Date | null;
  publishedAt: Date | null;
  finalizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateTryoutDraft = Omit<TryoutDraft, 'id'>;

export type SaveTryoutStep = Pick<
  TryoutDraft,
  'id' | 'organizationId' | 'status' | 'publishedAt' | 'finalizedAt' | 'updatedAt'
>;

/** Application port for durable tryout configuration storage. */
export interface TryoutGateway {
  createDraft(input: CreateTryoutDraft): Promise<TryoutDraft>;
  findById(input: {
    organizationId: OrganizationId;
    tryoutId: string;
  }): Promise<TryoutDraft | null>;
  saveStep(input: SaveTryoutStep): Promise<TryoutDraft>;
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
