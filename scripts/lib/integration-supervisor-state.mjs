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

const cleanupStages = [
  'active',
  'sessions-terminated',
  'fixtures-removed',
  'roots-removed',
  'rate-keys-removed',
  'registry-removed',
];

function authenticatedStatePayload(secret, body, cleanupStage) {
  return createHmac('sha256', secret).update(JSON.stringify({ body, cleanupStage })).digest('hex');
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

function atomicReplace(path, value, directory) {
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
  const commandPath = (runId) => join(directory, `${runId}.command.json`);
  const commandGoPath = (runId) => join(directory, `${runId}.command.go`);
  const commandCompletionPath = (runId) => join(directory, `${runId}.command.reaped.json`);
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
    commandPath,
    commandGoPath,
    commandCompletionPath,
    manifestBody: (runId) => manifestBody(identity, runId),
    writeManifest(body) {
      if (!validBody(body, identity, body?.runId)) {
        throw new Error('refusing inconsistent integration run manifest');
      }
      const path = manifestPath(body.runId);
      atomicWrite(
        path,
        JSON.stringify({
          body,
          cleanupStage: 'active',
          authentication: authenticatedStatePayload(secret, body, 'active'),
        }),
        directory,
      );
    },
    advanceCleanup(runId, cleanupStage) {
      if (!cleanupStages.includes(cleanupStage)) throw new Error('invalid cleanup stage');
      const path = manifestPath(runId);
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (!validBody(parsed?.body, identity, runId)) throw new Error('invalid cleanup manifest');
      const currentStage = parsed.cleanupStage ?? 'active';
      const currentIndex = cleanupStages.indexOf(currentStage);
      const nextIndex = cleanupStages.indexOf(cleanupStage);
      const skipsObsoleteRateStage =
        currentStage === 'roots-removed' && cleanupStage === 'registry-removed';
      if (
        currentIndex < 0 ||
        nextIndex < currentIndex ||
        (nextIndex > currentIndex + 1 && !skipsObsoleteRateStage)
      ) {
        throw new Error(`invalid cleanup stage transition ${currentStage} -> ${cleanupStage}`);
      }
      const currentAuthentication =
        parsed.cleanupStage === undefined
          ? authenticatedPayload(secret, parsed.body)
          : authenticatedStatePayload(secret, parsed.body, currentStage);
      if (
        typeof parsed.authentication !== 'string' ||
        parsed.authentication.length !== currentAuthentication.length ||
        !timingSafeEqual(Buffer.from(parsed.authentication), Buffer.from(currentAuthentication))
      ) {
        throw new Error('unauthenticated cleanup manifest');
      }
      atomicReplace(
        path,
        JSON.stringify({
          body: parsed.body,
          cleanupStage,
          authentication: authenticatedStatePayload(secret, parsed.body, cleanupStage),
        }),
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
          const cleanupStage = parsed.cleanupStage ?? 'active';
          if (!cleanupStages.includes(cleanupStage)) throw new Error('invalid cleanup stage');
          const expected =
            parsed.cleanupStage === undefined
              ? authenticatedPayload(secret, parsed.body)
              : authenticatedStatePayload(secret, parsed.body, cleanupStage);
          if (
            typeof parsed.authentication !== 'string' ||
            parsed.authentication.length !== expected.length ||
            !timingSafeEqual(Buffer.from(parsed.authentication), Buffer.from(expected))
          ) {
            throw new Error('forged manifest');
          }
          manifests.push({ body: parsed.body, cleanupStage, path });
        } catch {
          quarantine(path);
        }
      }
      return manifests;
    },
    writeCommand(runId, command) {
      const body = manifestBody(identity, runId);
      if (!command || !/^[0-9a-f]{32}$/u.test(command.nonce ?? '')) {
        throw new Error('invalid integration command identity');
      }
      const payload = { body, command: { nonce: command.nonce } };
      rmSync(commandCompletionPath(runId), { force: true });
      atomicWrite(
        commandPath(runId),
        JSON.stringify({
          ...payload,
          authentication: authenticatedPayload(secret, payload),
        }),
        directory,
      );
    },
    bindCommand(runId, command) {
      if (
        !Number.isSafeInteger(command?.pid) ||
        command.pid <= 1 ||
        command.pgid !== command.pid ||
        typeof command.startedAt !== 'string' ||
        command.startedAt.length < 8 ||
        command.startedAt.length > 80 ||
        !/^[0-9a-f]{32}$/u.test(command.nonce ?? '')
      ) {
        throw new Error('invalid bound integration command identity');
      }
      const pending = this.readCommand(runId);
      if (!pending || pending.nonce !== command.nonce || pending.pid !== undefined) {
        throw new Error('integration command capability changed before binding');
      }
      const body = manifestBody(identity, runId);
      const payload = { body, command };
      atomicReplace(
        commandPath(runId),
        JSON.stringify({
          ...payload,
          authentication: authenticatedPayload(secret, payload),
        }),
        directory,
      );
    },
    readCommand(runId) {
      const path = commandPath(runId);
      if (!existsSync(path)) return null;
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (!validBody(parsed?.body, identity, runId)) throw new Error('invalid command body');
      const payload = { body: parsed.body, command: parsed.command };
      const expected = authenticatedPayload(secret, payload);
      if (
        typeof parsed.authentication !== 'string' ||
        parsed.authentication.length !== expected.length ||
        !timingSafeEqual(Buffer.from(parsed.authentication), Buffer.from(expected))
      ) {
        throw new Error('unauthenticated integration command identity');
      }
      return parsed.command;
    },
    writeCommandCompletion(runId, command) {
      const current = this.readCommand(runId);
      if (JSON.stringify(current) !== JSON.stringify(command ?? null)) {
        throw new Error('reaping completion does not match authenticated command identity');
      }
      const body = manifestBody(identity, runId);
      const completion = { phase: 'command-group-stopped', command: command ?? null };
      const payload = { body, completion };
      atomicWrite(
        commandCompletionPath(runId),
        JSON.stringify({ ...payload, authentication: authenticatedPayload(secret, payload) }),
        directory,
      );
    },
    readCommandCompletion(runId) {
      const path = commandCompletionPath(runId);
      if (!existsSync(path)) return null;
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (!validBody(parsed?.body, identity, runId)) {
        throw new Error('invalid reaping completion body');
      }
      const payload = { body: parsed.body, completion: parsed.completion };
      const expected = authenticatedPayload(secret, payload);
      if (
        typeof parsed.authentication !== 'string' ||
        parsed.authentication.length !== expected.length ||
        !timingSafeEqual(Buffer.from(parsed.authentication), Buffer.from(expected))
      ) {
        throw new Error('unauthenticated reaping completion');
      }
      const current = this.readCommand(runId);
      if (
        parsed.completion?.phase !== 'command-group-stopped' ||
        JSON.stringify(parsed.completion.command ?? null) !== JSON.stringify(current)
      ) {
        throw new Error('stale reaping completion');
      }
      return parsed.completion;
    },
    removeCommandCompletion(runId) {
      rmSync(commandCompletionPath(runId), { force: true });
    },
    permitCommand(runId) {
      atomicWrite(commandGoPath(runId), runId, directory);
    },
    removeCommand(runId) {
      rmSync(commandPath(runId), { force: true });
      rmSync(commandGoPath(runId), { force: true });
      rmSync(commandCompletionPath(runId), { force: true });
    },
    removeRunState(runId) {
      rmSync(manifestPath(runId), { force: true });
      const descriptor = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
      try {
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
    },
  };
}
