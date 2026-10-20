import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { cleanupTask30AbuseRecords } from '../../e2e/helpers/fixtures';

const localSchema = z.object({ DB_URL: z.string().startsWith('postgresql://') }).passthrough();

function localDatabaseUrl() {
  return localSchema.parse(
    JSON.parse(
      execFileSync('./node_modules/.bin/supabase', ['status', '-o', 'json'], {
        encoding: 'utf8',
      }),
    ) as unknown,
  ).DB_URL;
}

function sql(databaseUrl: string, statement: string) {
  return execFileSync(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', statement],
    {
      encoding: 'utf8',
    },
  ).trim();
}

describe('Task 30 exact abuse cleanup', () => {
  it('deletes only registered task-owned keys and preserves unrelated sentinel rows', () => {
    const databaseUrl = localDatabaseUrl();
    const digest = () => randomBytes(32).toString('hex');
    const ownedRate = {
      subjectDigest: digest(),
      addressDigest: digest(),
      scope: 'public_registration' as const,
    };
    const sentinelRate = {
      subjectDigest: digest(),
      addressDigest: digest(),
      scope: 'public_registration' as const,
    };
    const ownedBot = { tokenDigest: digest(), action: 'public_registration' as const };
    const sentinelBot = { tokenDigest: digest(), action: 'public_registration' as const };
    sql(
      databaseUrl,
      `insert into private.abuse_rate_limits(subject_digest,address_digest,scope,attempts,window_started_at,expires_at) values('${ownedRate.subjectDigest}','${ownedRate.addressDigest}','${ownedRate.scope}',1,clock_timestamp(),clock_timestamp()+interval '10 minutes'),('${sentinelRate.subjectDigest}','${sentinelRate.addressDigest}','${sentinelRate.scope}',1,clock_timestamp(),clock_timestamp()+interval '10 minutes'); insert into private.bot_token_receipts(token_digest,action,expires_at) values('${ownedBot.tokenDigest}','${ownedBot.action}',clock_timestamp()+interval '5 minutes'),('${sentinelBot.tokenDigest}','${sentinelBot.action}',clock_timestamp()+interval '5 minutes');`,
    );
    try {
      cleanupTask30AbuseRecords(databaseUrl, [ownedRate], [ownedBot]);
      expect(
        sql(
          databaseUrl,
          `select (select count(*) from private.abuse_rate_limits where subject_digest='${ownedRate.subjectDigest}' and address_digest='${ownedRate.addressDigest}' and scope='${ownedRate.scope}')::text||'|'||(select count(*) from private.bot_token_receipts where token_digest='${ownedBot.tokenDigest}' and action='${ownedBot.action}')::text||'|'||(select count(*) from private.abuse_rate_limits where subject_digest='${sentinelRate.subjectDigest}' and address_digest='${sentinelRate.addressDigest}' and scope='${sentinelRate.scope}')::text||'|'||(select count(*) from private.bot_token_receipts where token_digest='${sentinelBot.tokenDigest}' and action='${sentinelBot.action}')::text`,
        ),
      ).toBe('0|0|1|1');
    } finally {
      sql(
        databaseUrl,
        `delete from private.abuse_rate_limits where subject_digest in('${ownedRate.subjectDigest}','${sentinelRate.subjectDigest}'); delete from private.bot_token_receipts where token_digest in('${ownedBot.tokenDigest}','${sentinelBot.tokenDigest}');`,
      );
    }
  });
});
