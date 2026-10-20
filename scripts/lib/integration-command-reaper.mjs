import { appendFileSync } from 'node:fs';

import {
  exactLauncherExists,
  findPendingLaunchers,
  groupRecords,
  processRecord,
} from './integration-process-identity.mjs';
import { createSupervisorStateStore } from './integration-supervisor-state.mjs';

const [supervisorPidText, supervisorStartedAt, runId, identity, completionCapability] =
  process.argv.slice(2);
const supervisorPid = Number.parseInt(supervisorPidText ?? '', 10);
if (!Number.isSafeInteger(supervisorPid) || supervisorPid <= 1)
  throw new Error('invalid supervisor');
if (
  !supervisorStartedAt ||
  !/^[0-9a-f]{16}$/u.test(runId ?? '') ||
  !/^[0-9a-f]{64}$/u.test(identity ?? '') ||
  !/^[0-9a-f]{32}$/u.test(completionCapability ?? '')
) {
  throw new Error('invalid reaper capability');
}
const state = createSupervisorStateStore({ identity });

function hook(phase) {
  if (process.env.NODE_ENV === 'test' && process.env.TRYOUTFLOW_INTEGRATION_TEST_HOOK_FILE) {
    appendFileSync(
      process.env.TRYOUTFLOW_INTEGRATION_TEST_HOOK_FILE,
      `${JSON.stringify({ phase, reaperPid: process.pid, runId, completionCapability })}\n`,
    );
  }
}

hook('reaper-started');
if (
  process.env.NODE_ENV === 'test' &&
  process.env.TRYOUTFLOW_INTEGRATION_TEST_FORCE_REAPER_FAILURE === '1'
) {
  process.exit(86);
}
while (processRecord(supervisorPid)?.startedAt === supervisorStartedAt) {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

let command = state.readCommand(runId);
if (command && command.pid === undefined) {
  const matches = findPendingLaunchers(command.nonce);
  if (matches.length > 1) throw new Error('ambiguous integration command launcher identity');
  if (matches.length === 1) {
    command = { ...matches[0], nonce: command.nonce };
    state.bindCommand(runId, command);
  }
}

if (command?.pid !== undefined) {
  let members = groupRecords(command.pgid);
  if (members.length > 0) {
    if (!exactLauncherExists(command)) {
      throw new Error('integration command group exists without its exact launcher identity');
    }
    hook('reaper-term');
    try {
      process.kill(-command.pgid, 'SIGTERM');
    } catch {
      // Absence is established below from the complete process table, never from kill(2).
    }
    const termDeadline = Date.now() + 1_000;
    while (Date.now() < termDeadline && groupRecords(command.pgid).length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    members = groupRecords(command.pgid);
    if (members.length > 0) {
      if (!exactLauncherExists(command)) {
        throw new Error('integration command identity disappeared before bounded escalation');
      }
      hook('reaper-kill');
      try {
        process.kill(-command.pgid, 'SIGKILL');
      } catch {
        // Absence is established below from the complete process table, never from kill(2).
      }
      while (groupRecords(command.pgid).length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
  }
} else if (command) {
  const matches = findPendingLaunchers(command.nonce);
  if (matches.length > 0) {
    throw new Error('unbound integration launcher remained after identity resolution');
  }
}

hook('command-group-stopped');
state.writeCommandCompletion(runId, completionCapability, command);
