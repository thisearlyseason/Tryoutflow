import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

import { createSupervisorStateStore } from './integration-supervisor-state.mjs';

const [supervisorPidText, supervisorStartedAt, runId, identity] = process.argv.slice(2);
const supervisorPid = Number.parseInt(supervisorPidText ?? '', 10);
if (!Number.isSafeInteger(supervisorPid) || supervisorPid <= 1)
  throw new Error('invalid supervisor');
if (
  !supervisorStartedAt ||
  !/^[0-9a-f]{16}$/u.test(runId ?? '') ||
  !/^[0-9a-f]{64}$/u.test(identity ?? '')
) {
  throw new Error('invalid reaper capability');
}
const state = createSupervisorStateStore({ identity });

function processRecord(pid) {
  try {
    const output = execFileSync('ps', ['-o', 'pid=,pgid=,lstart=,command=', '-p', String(pid)], {
      encoding: 'utf8',
    }).trim();
    const match = /^(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/u.exec(output);
    if (!match) return null;
    return {
      pid: Number(match[1]),
      pgid: Number(match[2]),
      startedAt: match[3].trim(),
      command: match[4],
    };
  } catch {
    return null;
  }
}

while (processRecord(supervisorPid)?.startedAt === supervisorStartedAt) {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

let command;
try {
  command = state.readCommand(runId);
} catch {
  process.exitCode = 1;
}
if (command) {
  if (command.pid === undefined) {
    const matches = execFileSync('ps', ['-axo', 'pid=,pgid=,lstart=,command='], {
      encoding: 'utf8',
    })
      .split('\n')
      .map((line) => /^(\s*\d+)\s+(\d+)\s+(.{24})\s+(.+)$/u.exec(line))
      .filter(Boolean)
      .map((match) => ({
        pid: Number(match[1]),
        pgid: Number(match[2]),
        startedAt: match[3].trim(),
        command: match[4],
      }))
      .filter(
        (candidate) =>
          candidate.pid === candidate.pgid &&
          candidate.command.includes('integration-command-launcher.mjs') &&
          candidate.command.includes(command.nonce),
      );
    if (matches.length === 1) command = { ...matches[0], nonce: command.nonce };
  }
  const exact = () => {
    if (command.pid === undefined) return false;
    const record = processRecord(command.pid);
    return Boolean(
      record &&
      record.pid === command.pid &&
      record.pgid === command.pgid &&
      record.startedAt === command.startedAt &&
      record.command.includes('integration-command-launcher.mjs') &&
      record.command.includes(command.nonce),
    );
  };
  if (exact()) {
    const groupExists = () => {
      try {
        return execFileSync('ps', ['-axo', 'pgid='], { encoding: 'utf8' })
          .split('\n')
          .some((value) => Number(value.trim()) === command.pgid);
      } catch {
        return true;
      }
    };
    try {
      process.kill(-command.pgid, 'SIGTERM');
    } catch {}
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline && groupExists())
      await new Promise((resolve) => setTimeout(resolve, 20));
    if (groupExists()) {
      try {
        process.kill(-command.pgid, 'SIGKILL');
      } catch {}
    }
    while (groupExists()) await new Promise((resolve) => setTimeout(resolve, 20));
    if (process.env.NODE_ENV === 'test' && process.env.TRYOUTFLOW_INTEGRATION_TEST_HOOK_FILE) {
      appendFileSync(
        process.env.TRYOUTFLOW_INTEGRATION_TEST_HOOK_FILE,
        `${JSON.stringify({ phase: 'command-group-stopped', reaperPid: process.pid, runId })}\n`,
      );
    }
  }
  state.removeCommand(runId);
}
