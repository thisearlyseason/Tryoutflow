import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertIsolatedReleaseDatabaseUrl,
  assertIsolatedReleaseDatabaseProof,
  assertIsolatedReleaseApiProof,
} from '../lib/isolated-release-database.mjs';
const project = 'tryoutflow-lint-verify-012345abcdef';
const fixture = () => ({
  expectedProject: project,
  workdir: '/fresh/worktree',
  configHash: 'a'.repeat(64),
  databasePort: '43132',
  proof: {
    schemaVersion: 1,
    freshCreatedForThisRun: true,
    projectId: project,
    workdir: '/fresh/worktree',
    databaseContainerId: 'fresh-id',
    databaseIdentity: 'fresh-system-identity',
    configSHA256: 'a'.repeat(64),
    networkId: 'fresh-network',
    apiContainerId: 'fresh-api',
    apiOrigin: 'http://127.0.0.1:43131',
  },
  selected: {
    id: 'fresh-id',
    networkIds: ['fresh-network'],
    ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '43132' }] },
    identity: 'fresh-system-identity',
    database: 'postgres',
    labels: { 'com.supabase.cli.project': project, 'com.supabase.cli.workdir': '/fresh/worktree' },
  },
});
test('accept exact freshly created project/container/system identity proof', () =>
  assertIsolatedReleaseDatabaseProof(fixture()));
test('accept an explicit loopback test port', () =>
  assertIsolatedReleaseDatabaseUrl('postgresql://postgres:postgres@127.0.0.1:43132/postgres'));
for (const value of [
  'postgresql://example.com:43132/postgres',
  'postgresql://127.0.0.1:43132/postgres?host=example.com',
  'postgresql://127.0.0.1:43132/postgres?hostaddr=192.0.2.1',
  'postgresql://127.0.0.1:43132/postgres#fragment',
  'postgresql://127.0.0.1/postgres',
  'https://127.0.0.1:43132/postgres',
  'postgresql://127.0.0.1:43132/owner_database',
])
  test(`reject unsafe target ${value}`, () =>
    assert.throws(() => assertIsolatedReleaseDatabaseUrl(value)));
for (const [name, change] of [
  [
    'owner project',
    (x) => {
      x.expectedProject = 'tryoutflow';
    },
  ],
  [
    'not newly created',
    (x) => {
      x.proof.freshCreatedForThisRun = false;
    },
  ],
  [
    'wrong project proof',
    (x) => {
      x.proof.projectId = 'another';
    },
  ],
  [
    'wrong proof workdir',
    (x) => {
      x.proof.workdir = '/owner';
    },
  ],
  [
    'wrong container',
    (x) => {
      x.selected.id = 'owner-id';
    },
  ],
  [
    'wrong system identity',
    (x) => {
      x.selected.identity = 'owner-system';
    },
  ],
  [
    'wrong container project label',
    (x) => {
      x.selected.labels['com.supabase.cli.project'] = 'owner';
    },
  ],
  [
    'wrong container workdir label',
    (x) => {
      x.selected.labels['com.supabase.cli.workdir'] = '/owner';
    },
  ],
  [
    'wrong database',
    (x) => {
      x.selected.database = 'owner';
    },
  ],
])
  test(`reject ${name}`, () => {
    const value = fixture();
    change(value);
    assert.throws(() => assertIsolatedReleaseDatabaseProof(value));
  });

for (const [name, change] of [
  [
    'config changed',
    (x) => {
      x.configHash = 'b'.repeat(64);
    },
  ],
  [
    'wildcard database binding',
    (x) => {
      x.selected.ports['5432/tcp'][0].HostIp = '0.0.0.0';
    },
  ],
  [
    'wrong database port',
    (x) => {
      x.selected.ports['5432/tcp'][0].HostPort = '58322';
    },
  ],
  [
    'another network',
    (x) => {
      x.selected.networkIds = ['owner-network'];
    },
  ],
  [
    'additional network',
    (x) => {
      x.selected.networkIds.push('owner-network');
    },
  ],
])
  test(`reject isolated target ${name}`, () => {
    const value = fixture();
    change(value);
    assert.throws(() => assertIsolatedReleaseDatabaseProof(value));
  });

const apiFixture = () => {
  const base = fixture();
  return {
    ...base,
    apiUrl: 'http://127.0.0.1:43131',
    selected: {
      id: 'fresh-api',
      labels: base.selected.labels,
      networkIds: ['fresh-network'],
      ports: { '8000/tcp': [{ HostIp: '127.0.0.1', HostPort: '43131' }] },
    },
  };
};
test('accept exact owned loopback API on same fresh network', () =>
  assertIsolatedReleaseApiProof(apiFixture()));
for (const [name, change] of [
  [
    'remote API',
    (x) => {
      x.apiUrl = 'http://example.com:43131';
    },
  ],
  [
    'API query parameters',
    (x) => {
      x.apiUrl += '?host=example.com';
    },
  ],
  [
    'wrong API container',
    (x) => {
      x.selected.id = 'owner-api';
    },
  ],
  [
    'wrong API project',
    (x) => {
      x.selected.labels['com.supabase.cli.project'] = 'owner';
    },
  ],
  [
    'wrong API workdir',
    (x) => {
      x.selected.labels['com.supabase.cli.workdir'] = '/owner';
    },
  ],
  [
    'wildcard API binding',
    (x) => {
      x.selected.ports['8000/tcp'][0].HostIp = '0.0.0.0';
    },
  ],
  [
    'wrong API port',
    (x) => {
      x.selected.ports['8000/tcp'][0].HostPort = '58321';
    },
  ],
  [
    'wrong API network',
    (x) => {
      x.selected.networkIds = ['owner-network'];
    },
  ],
])
  test(`reject isolated API ${name}`, () => {
    const value = apiFixture();
    change(value);
    assert.throws(() => assertIsolatedReleaseApiProof(value));
  });
