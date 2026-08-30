import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const runIdPattern = /^[0-9a-f]{16}$/u;
const identityPattern = /^[0-9a-f]{64}$/u;
const manifestEntryPattern = /^([0-9a-f]{16})\.json$/u;

function ensurePrivateDirectory(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  const uid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    stat.uid !== uid ||
    (stat.mode & 0o777) !== 0o700
  ) {
    throw new Error(`integration supervisor private directory is unsafe: ${path}`);
  }
}

function readOrCreateSecret(directory) {
  const path = join(directory, 'installation.key');
  if (!existsSync(path)) {
    const descriptor = openSync(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeSync(descriptor, randomBytes(32));
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    const directoryDescriptor = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  }
  const stat = lstatSync(path);
  const uid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.uid !== uid ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.size !== 32
  ) {
    throw new Error('integration supervisor installation secret is unsafe');
  }
  return readFileSync(path);
}

function manifestBody(identity, runId) {
  if (!runIdPattern.test(runId)) throw new Error('invalid integration run id');
  return {
    version: 1,
    runId,
    databaseIdentity: identity,
    role: `tryoutflow_run_${runId}`,
    ownershipSchema: `tryoutflow_harness_${runId}`,
    databasePrefixes: [
      `tryoutflow_csv_${runId}_`,
      `tryoutflow_roster_${runId}_`,
      `tryoutflow_fixture_${runId}_`,
    ],
  };
}

function authenticatedPayload(secret, body) {
  return createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
}

function validBody(candidate, identity, filenameRunId) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  const expected = manifestBody(identity, filenameRunId);
  return JSON.stringify(candidate) === JSON.stringify(expected);
}

function atomicWrite(path, value, directory) {
  const temporaryPath = `${path}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`;
  const descriptor = openSync(
    temporaryPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeSync(descriptor, value);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  if (existsSync(path)) {
    rmSync(temporaryPath, { force: true });
    throw new Error('refusing to replace an existing integration run manifest');
  }
  renameSync(temporaryPath, path);
  const directoryDescriptor = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    fsyncSync(directoryDescriptor);
  } finally {
    closeSync(directoryDescriptor);
  }
}

export function createSupervisorStateStore(options) {
  const identity = options?.identity;
  if (!identityPattern.test(identity ?? ''))
    throw new Error('invalid integration database identity');
  const baseDirectory =
    options?.baseDirectory ?? join(homedir(), '.tryoutflow', 'integration-supervisor');
  ensurePrivateDirectory(baseDirectory);
  const secret = readOrCreateSecret(baseDirectory);
  const directory = join(baseDirectory, identity);
  ensurePrivateDirectory(directory);

  const manifestPath = (runId) => join(directory, `${runId}.json`);
  const rateKeyPath = (runId) => join(directory, `${runId}.rate-keys`);
  const quarantine = (path) => {
    try {
      renameSync(path, `${path}.quarantine-${Date.now()}-${randomBytes(4).toString('hex')}`);
    } catch {
      // A concurrent recovery already moved the untrusted entry.
    }
  };

  return {
    directory,
    manifestPath,
    rateKeyPath,
    manifestBody: (runId) => manifestBody(identity, runId),
    writeManifest(body) {
      if (!validBody(body, identity, body?.runId)) {
        throw new Error('refusing inconsistent integration run manifest');
      }
      const path = manifestPath(body.runId);
      atomicWrite(
        path,
        JSON.stringify({ body, authentication: authenticatedPayload(secret, body) }),
        directory,
      );
    },
    readRecoverableManifests(excludedRunId) {
      const manifests = [];
      for (const entry of readdirSync(directory)) {
        const match = manifestEntryPattern.exec(entry);
        if (!match) {
          if (entry.includes('.json.tmp-')) quarantine(join(directory, entry));
          continue;
        }
        if (match[1] === excludedRunId) continue;
        const path = join(directory, entry);
        try {
          const stat = lstatSync(path);
          if (
            stat.isSymbolicLink() ||
            !stat.isFile() ||
            (stat.mode & 0o077) !== 0 ||
            stat.size > 4_096
          ) {
            throw new Error('unsafe manifest file');
          }
          const parsed = JSON.parse(readFileSync(path, 'utf8'));
          if (!validBody(parsed?.body, identity, match[1])) throw new Error('mixed manifest');
          const expected = authenticatedPayload(secret, parsed.body);
          if (
            typeof parsed.authentication !== 'string' ||
            parsed.authentication.length !== expected.length ||
            !timingSafeEqual(Buffer.from(parsed.authentication), Buffer.from(expected))
          ) {
            throw new Error('forged manifest');
          }
          manifests.push({ body: parsed.body, path });
        } catch {
          quarantine(path);
        }
      }
      return manifests;
    },
    readRateKeys(runId) {
      const path = rateKeyPath(runId);
      if (!existsSync(path)) return [];
      const stat = lstatSync(path);
      if (
        stat.isSymbolicLink() ||
        !stat.isFile() ||
        (stat.mode & 0o077) !== 0 ||
        stat.size > 1024 * 1024
      ) {
        quarantine(path);
        throw new Error('unsafe integration rate-key ownership log');
      }
      const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
      if (lines.some((line) => !/^[0-9a-f]{64}$/u.test(line))) {
        quarantine(path);
        throw new Error('corrupt integration rate-key ownership log');
      }
      return [...new Set(lines)];
    },
    removeRunState(runId) {
      rmSync(manifestPath(runId), { force: true });
      rmSync(rateKeyPath(runId), { force: true });
      const descriptor = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
      try {
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
    },
  };
}
