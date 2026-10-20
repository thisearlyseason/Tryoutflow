type Brand<Name extends string> = string & {
  readonly __brand: Name;
};

export type UserId = Brand<'UserId'>;
export type ProfileId = Brand<'ProfileId'>;
export type OrganizationId = Brand<'OrganizationId'>;
export type AuditLogId = Brand<'AuditLogId'>;
export type AuditEntityId = Brand<'AuditEntityId'>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseUuid<Name extends string>(value: string, label: string): Brand<Name> {
  if (!uuidPattern.test(value)) {
    throw new Error(`Invalid ${label} ID`);
  }

  return value as Brand<Name>;
}

export function parseUserId(value: string): UserId {
  return parseUuid<'UserId'>(value, 'user');
}

export function parseProfileId(value: string): ProfileId {
  return parseUuid<'ProfileId'>(value, 'profile');
}

export function parseOrganizationId(value: string): OrganizationId {
  return parseUuid<'OrganizationId'>(value, 'organization');
}

export function parseAuditLogId(value: string): AuditLogId {
  return parseUuid<'AuditLogId'>(value, 'audit log');
}

export function parseAuditEntityId(value: string): AuditEntityId {
  return parseUuid<'AuditEntityId'>(value, 'audit entity');
}
