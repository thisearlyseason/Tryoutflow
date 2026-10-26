import { describe, expect, it } from 'vitest';

import {
  assertDatabaseIdentity,
  canonicalDatabaseIdentity,
  selectDatabaseContainer,
  type DockerDatabaseContainer,
} from '../../../scripts/lib/local-supabase-database.mjs';

const candidate = (
  name: string,
  hostPort: string,
  overrides: Partial<DockerDatabaseContainer> = {},
): DockerDatabaseContainer => ({
  id: `${name}-id`,
  name,
  labels: {
    'com.supabase.cli.project': name.replace('supabase_db_', ''),
    'com.supabase.cli.workdir': `/workspace/${name}`,
  },
  ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: hostPort }] },
  ...overrides,
});

describe('local Supabase database container resolution', () => {
  it('selects only the container publishing the configured database endpoint', () => {
    expect(
      selectDatabaseContainer('postgresql://postgres:secret@127.0.0.1:54322/postgres', [
        candidate('supabase_db_other', '54323'),
        candidate('supabase_db_tryoutflow', '54322'),
      ]),
    ).toMatchObject({ name: 'supabase_db_tryoutflow', database: 'postgres' });
  });

  it('accepts an explicit loopback binding for localhost and rejects remote bindings', () => {
    expect(
      selectDatabaseContainer('postgresql://postgres:secret@localhost:54322/postgres', [
        candidate('supabase_db_remote', '54322', {
          ports: { '5432/tcp': [{ HostIp: '192.0.2.10', HostPort: '54322' }] },
        }),
        candidate('supabase_db_local', '54322', {
          ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '54322' }] },
        }),
      ]),
    ).toMatchObject({ name: 'supabase_db_local' });
  });

  it('fails closed when no running Supabase database matches', () => {
    expect(() =>
      selectDatabaseContainer('postgresql://postgres:secret@127.0.0.1:54322/postgres', [
        candidate('supabase_db_other', '54323'),
      ]),
    ).toThrow(/no Supabase database container matches/u);
  });

  it('fails closed when multiple containers publish the same configured endpoint', () => {
    expect(() =>
      selectDatabaseContainer('postgresql://postgres:secret@127.0.0.1:54322/postgres', [
        candidate('supabase_db_one', '54322'),
        candidate('supabase_db_two', '54322'),
      ]),
    ).toThrow(/multiple Supabase database containers match/u);
  });

  it('ignores a matching port unless container metadata identifies one Supabase database project', () => {
    expect(() =>
      selectDatabaseContainer('postgresql://postgres:secret@127.0.0.1:54322/postgres', [
        candidate('ordinary_postgres', '54322', { labels: {} }),
      ]),
    ).toThrow(/no Supabase database container matches/u);
  });

  it('rejects a URL without an explicit database or port', () => {
    expect(() =>
      selectDatabaseContainer('postgresql://postgres:secret@localhost/postgres', []),
    ).toThrow(/explicit port/u);
    expect(() =>
      selectDatabaseContainer('postgresql://postgres:secret@localhost:54322', []),
    ).toThrow(/explicit database/u);
  });

  it('fails closed when the endpoint and selected container identify different clusters', () => {
    expect(() =>
      assertDatabaseIdentity('postgres|cluster-a', 'postgres|cluster-b', {
        name: 'supabase_db_tryoutflow',
        database: 'postgres',
      }),
    ).toThrow(/does not identify container/u);
    expect(() =>
      assertDatabaseIdentity('', 'postgres|cluster-a', {
        name: 'supabase_db_tryoutflow',
        database: 'postgres',
      }),
    ).toThrow(/does not identify container/u);
    expect(() =>
      assertDatabaseIdentity('postgres|cluster-a', 'postgres|cluster-a', {
        name: 'supabase_db_tryoutflow',
        database: 'postgres',
      }),
    ).not.toThrow();
  });

  it('derives one lock identity from server facts rather than URL spelling or credentials', () => {
    expect(canonicalDatabaseIdentity('postgres|16384|761234567890')).toBe(
      canonicalDatabaseIdentity('postgres|16384|761234567890'),
    );
    expect(canonicalDatabaseIdentity('postgres|16385|761234567890')).not.toBe(
      canonicalDatabaseIdentity('postgres|16384|761234567890'),
    );
  });

  it('rejects malformed server identity before it can become a coordination key', () => {
    for (const identity of ['', 'postgres|cluster', 'postgres|abc|123', 'postgres|1|abc']) {
      expect(() => canonicalDatabaseIdentity(identity)).toThrow(/database identity/u);
    }
  });
});
