import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const runIdPattern = /^[0-9a-f]{16}$/u;
const identityPattern = /^[0-9a-f]{64}$/u;
const manifestEntryPattern = /^([0-9a-f]{16})\.json$/u;
const completionCapabilityPattern = /^[0-9a-f]{32}$/u;
const maximumStateBytes = 4_096;

function currentUid(fallback) {
  return typeof process.getuid === 'function' ? process.getuid() : fallback;
}

function validatePrivateRegularFile(stat, label, maximumBytes, exactBytes) {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== currentUid(stat.uid) ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.size < 0 ||
    stat.size > maximumBytes ||
    (exactBytes !== undefined && stat.size !== exactBytes)
  ) {
    throw new Error(`unsafe ${label}`);
  }
}

function readPrivateRegularFile(
  path,
  label,
  { missing = false, maximumBytes = maximumStateBytes, exactBytes } = {},
) {
  let before;
  try {
    before = lstatSync(path);
  } catch (error) {
    if (missing && error?.code === 'ENOENT') return null;
    throw error;
  }
  validatePrivateRegularFile(before, label, maximumBytes, exactBytes);
  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const opened = fstatSync(descriptor);
    validatePrivateRegularFile(opened, label, maximumBytes, exactBytes);
    if (opened.dev !== before.dev || opened.ino !== before.ino) throw new Error(`unsafe ${label}`);
    const buffer = Buffer.alloc(opened.size + 1);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    const after = fstatSync(descriptor);
    validatePrivateRegularFile(after, label, maximumBytes, exactBytes);
    if (
      bytesRead !== opened.size ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size
    ) {
      throw new Error(`unsafe ${label}`);
    }
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(descriptor);
  }
}

function fsyncDirectory(directory) {
  const descriptor = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function bestEffortRemovePrivateRegularFile(path) {
  try {
    const stat = lstatSync(path);
    validatePrivateRegularFile(stat, 'integration supervisor state file', maximumStateBytes);
    unlinkSync(path);
  } catch {
    // Untrusted or concurrently replaced evidence is retained and never escapes fail-closed control.
  }
}

function writeBounded(descriptor, value) {
  const serialized = Buffer.from(value);
  if (serialized.length > maximumStateBytes) {
    throw new Error('integration supervisor state exceeds the safe size limit');
  }
  let offset = 0;
  while (offset < serialized.length) {
    offset += writeSync(descriptor, serialized, offset, serialized.length - offset);
  }
}

function immutableCompletionProofOperations(overrides) {
  return {
    closeSync,
    fstatSync,
    fsyncSync,
    lstatSync,
    openSync,
    writeSync,
    ...overrides,
  };
}

function validatePathMatchesDescriptor(path, descriptorStat, operations, exactBytes) {
  const pathStat = operations.lstatSync(path);
  validatePrivateRegularFile(
    pathStat,
    'integration command completion',
    maximumStateBytes,
    exactBytes,
  );
  if (pathStat.dev !== descriptorStat.dev || pathStat.ino !== descriptorStat.ino) {
    throw new Error('unsafe integration command completion path identity');
  }
}

function fsyncValidatedPrivateDirectory(directory, directoryIdentity, validateStateDirectory) {
  validateStateDirectory();
  const descriptor = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    const opened = fstatSync(descriptor);
    if (
      !opened.isDirectory() ||
      opened.uid !== currentUid(opened.uid) ||
      (opened.mode & 0o777) !== 0o700 ||
      opened.dev !== directoryIdentity.dev ||
      opened.ino !== directoryIdentity.ino
    ) {
      throw new Error('unsafe integration supervisor private directory');
    }
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  validateStateDirectory();
}

function writeImmutableCompletionProof(
  path,
  value,
  directory,
  directoryIdentity,
  validateStateDirectory,
  operations,
) {
  const serialized = Buffer.from(value);
  if (serialized.length > maximumStateBytes) {
    throw new Error('integration supervisor state exceeds the safe size limit');
  }

  validateStateDirectory();
  let descriptor;
  let failure;
  try {
    descriptor = operations.openSync(
      path,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW |
        constants.O_CLOEXEC,
      0o600,
    );
    const opened = operations.fstatSync(descriptor);
    validatePrivateRegularFile(opened, 'integration command completion', maximumStateBytes, 0);
    validatePathMatchesDescriptor(path, opened, operations, 0);

    let offset = 0;
    while (offset < serialized.length) {
      const written = operations.writeSync(
        descriptor,
        serialized,
        offset,
        serialized.length - offset,
      );
      if (!Number.isSafeInteger(written) || written <= 0) {
        throw new Error('unable to make progress writing integration command completion');
      }
      offset += written;
    }
    operations.fsyncSync(descriptor);
    const completed = operations.fstatSync(descriptor);
    validatePrivateRegularFile(
      completed,
      'integration command completion',
      maximumStateBytes,
      serialized.length,
    );
    if (completed.dev !== opened.dev || completed.ino !== opened.ino) {
      throw new Error('unsafe integration command completion descriptor identity');
    }
    validatePathMatchesDescriptor(path, completed, operations, serialized.length);
  } catch (error) {
    failure = error;
    if (descriptor !== undefined) {
      try {
        operations.fsyncSync(descriptor);
      } catch {
        // Retain the partial inode; the reader rejects it and a fresh capability is required.
      }
    }
  } finally {
    if (descriptor !== undefined) {
      try {
        operations.closeSync(descriptor);
      } catch (error) {
        failure ??= error;
      }
    }
  }

  if (descriptor !== undefined) {
    try {
      fsyncValidatedPrivateDirectory(directory, directoryIdentity, validateStateDirectory);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
}

function ensurePrivateDirectory(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  const uid = currentUid(stat.uid);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    stat.uid !== uid ||
    (stat.mode & 0o777) !== 0o700
  ) {
    throw new Error(`integration supervisor private directory is unsafe: ${path}`);
  }
  return stat;
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
    fsyncDirectory(directory);
  }
  return readPrivateRegularFile(path, 'integration supervisor installation secret', {
    maximumBytes: 32,
    exactBytes: 32,
  });
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
  let descriptor;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    writeBounded(descriptor, value);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    linkSync(temporaryPath, path);
    unlinkSync(temporaryPath);
    fsyncDirectory(directory);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The temporary file was already linked and removed, or cleanup is best effort.
    }
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
    writeBounded(descriptor, value);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporaryPath, path);
  fsyncDirectory(directory);
}

/**
 * @param {{
 *   identity: string,
 *   baseDirectory?: string,
 *   completionProofOperations?: Partial<{
 *     closeSync: typeof closeSync,
 *     fstatSync: typeof fstatSync,
 *     fsyncSync: typeof fsyncSync,
 *     lstatSync: typeof lstatSync,
 *     openSync: typeof openSync,
 *     writeSync: typeof writeSync,
 *   }>,
 * }} options
 */
export function createSupervisorStateStore(options) {
  const identity = options?.identity;
  if (!identityPattern.test(identity ?? ''))
    throw new Error('invalid integration database identity');
  const baseDirectory =
    options?.baseDirectory ?? join(homedir(), '.tryoutflow', 'integration-supervisor');
  ensurePrivateDirectory(baseDirectory);
  const secret = readOrCreateSecret(baseDirectory);
  const directory = join(baseDirectory, identity);
  const directoryIdentity = ensurePrivateDirectory(directory);
  const completionProofOperations = immutableCompletionProofOperations(
    options?.completionProofOperations,
  );
  const validateStateDirectory = () => {
    const current = ensurePrivateDirectory(directory);
    if (current.dev !== directoryIdentity.dev || current.ino !== directoryIdentity.ino) {
      throw new Error(`integration supervisor private directory identity changed: ${directory}`);
    }
  };

  const manifestPath = (runId) => join(directory, `${runId}.json`);
  const commandPath = (runId) => join(directory, `${runId}.command.json`);
  const commandGoPath = (runId) => join(directory, `${runId}.command.go`);
  const commandCompletionPath = (runId, capability) => {
    if (!runIdPattern.test(runId) || !completionCapabilityPattern.test(capability ?? '')) {
      throw new Error('invalid integration reaping proof capability');
    }
    return join(directory, `${runId}.command.reaped-${capability}.json`);
  };
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
      validateStateDirectory();
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
      validateStateDirectory();
      if (!cleanupStages.includes(cleanupStage)) throw new Error('invalid cleanup stage');
      const path = manifestPath(runId);
      const parsed = JSON.parse(readPrivateRegularFile(path, 'cleanup manifest').toString('utf8'));
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
      validateStateDirectory();
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
          const parsed = JSON.parse(
            readPrivateRegularFile(path, 'integration manifest').toString('utf8'),
          );
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
      validateStateDirectory();
      const body = manifestBody(identity, runId);
      if (!command || !/^[0-9a-f]{32}$/u.test(command.nonce ?? '')) {
        throw new Error('invalid integration command identity');
      }
      const payload = { body, command: { nonce: command.nonce } };
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
      validateStateDirectory();
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
      validateStateDirectory();
      const path = commandPath(runId);
      const serialized = readPrivateRegularFile(path, 'integration command identity', {
        missing: true,
      });
      if (!serialized) return null;
      const parsed = JSON.parse(serialized.toString('utf8'));
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
    writeCommandCompletion(runId, capability, command) {
      validateStateDirectory();
      const current = this.readCommand(runId);
      if (JSON.stringify(current) !== JSON.stringify(command ?? null)) {
        throw new Error('reaping completion does not match authenticated command identity');
      }
      const body = manifestBody(identity, runId);
      if (!completionCapabilityPattern.test(capability ?? '')) {
        throw new Error('invalid integration reaping proof capability');
      }
      const completion = { phase: 'command-group-stopped', command: command ?? null };
      const payload = { body, capability, completion };
      writeImmutableCompletionProof(
        commandCompletionPath(runId, capability),
        JSON.stringify({ ...payload, authentication: authenticatedPayload(secret, payload) }),
        directory,
        directoryIdentity,
        validateStateDirectory,
        completionProofOperations,
      );
    },
    readCommandCompletion(runId, capability) {
      validateStateDirectory();
      if (!completionCapabilityPattern.test(capability ?? '')) {
        throw new Error('invalid integration reaping proof capability');
      }
      const path = commandCompletionPath(runId, capability);
      const serialized = readPrivateRegularFile(path, 'integration command completion', {
        missing: true,
      });
      if (!serialized) return null;
      const parsed = JSON.parse(serialized.toString('utf8'));
      if (!validBody(parsed?.body, identity, runId)) {
        throw new Error('invalid reaping completion body');
      }
      if (parsed.capability !== capability) throw new Error('stale reaping proof capability');
      const payload = {
        body: parsed.body,
        capability: parsed.capability,
        completion: parsed.completion,
      };
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
    permitCommand(runId) {
      validateStateDirectory();
      atomicWrite(commandGoPath(runId), runId, directory);
    },
    removeCommand(runId) {
      try {
        validateStateDirectory();
        bestEffortRemovePrivateRegularFile(commandPath(runId));
        bestEffortRemovePrivateRegularFile(commandGoPath(runId));
      } catch {
        // Untrusted directory replacement is retained for explicit operator recovery.
      }
    },
    removeRunState(runId) {
      validateStateDirectory();
      bestEffortRemovePrivateRegularFile(manifestPath(runId));
      const descriptor = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
      try {
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
    },
  };
}
