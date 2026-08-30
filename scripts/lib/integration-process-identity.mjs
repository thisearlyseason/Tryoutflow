import { execFileSync } from 'node:child_process';

function parseRecord(line) {
  const match = /^(\s*\d+)\s+(\d+)\s+(.{24})\s+(.+)$/u.exec(line);
  if (!match) return null;
  return {
    pid: Number(match[1]),
    pgid: Number(match[2]),
    startedAt: match[3].trim(),
    command: match[4],
  };
}

export function listProcessRecords() {
  return execFileSync('ps', ['-axo', 'pid=,pgid=,lstart=,command='], {
    encoding: 'utf8',
  })
    .split('\n')
    .map(parseRecord)
    .filter(Boolean);
}

export function processRecord(pid) {
  try {
    const output = execFileSync('ps', ['-o', 'pid=,pgid=,lstart=,command=', '-p', String(pid)], {
      encoding: 'utf8',
    }).trim();
    return parseRecord(output);
  } catch {
    return null;
  }
}

export function exactLauncherExists(command) {
  if (!Number.isSafeInteger(command?.pid) || command.pid <= 1) return false;
  const record = processRecord(command.pid);
  return Boolean(
    record &&
    record.pid === command.pid &&
    record.pgid === command.pgid &&
    record.startedAt === command.startedAt &&
    record.command.includes('integration-command-launcher.mjs') &&
    record.command.includes(command.nonce),
  );
}

export function groupRecords(pgid) {
  return listProcessRecords().filter((record) => record.pgid === pgid);
}

export function findPendingLaunchers(nonce) {
  return listProcessRecords().filter(
    (candidate) =>
      candidate.pid === candidate.pgid &&
      candidate.command.includes('integration-command-launcher.mjs') &&
      candidate.command.includes(nonce),
  );
}

export function commandIsProvenAbsent(command) {
  if (!command) return true;
  if (command.pid === undefined) return findPendingLaunchers(command.nonce).length === 0;
  return groupRecords(command.pgid).length === 0;
}
