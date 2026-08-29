import { spawn } from 'node:child_process';

const command = JSON.parse(process.argv[2] ?? 'null');
const ownerPid = Number.parseInt(process.argv[3] ?? '', 10);
if (
  !Array.isArray(command) ||
  command.length === 0 ||
  command.some((value) => typeof value !== 'string')
) {
  throw new Error('run-when-ready requires a non-empty string command array');
}
if (!Number.isSafeInteger(ownerPid) || ownerPid <= 1) {
  throw new Error('run-when-ready requires its owner process ID');
}

const ready = await new Promise((resolveReady) => {
  process.stdin.once('data', () => resolveReady(true));
  process.stdin.once('end', () => resolveReady(false));
});
if (!ready) process.exit(1);
const [executable, ...args] = command;
const child = spawn(executable, args, { stdio: 'inherit' });
process.once('SIGINT', () => child.kill('SIGINT'));
process.once('SIGTERM', () => child.kill('SIGTERM'));
let escalation;
const ownerWatch = setInterval(() => {
  if (process.ppid === ownerPid) return;
  child.kill('SIGTERM');
  escalation ??= setTimeout(() => child.kill('SIGKILL'), 1_000);
}, 50);
const result = await new Promise((resolveResult) => {
  child.once('error', (error) => resolveResult({ code: 1, error }));
  child.once('close', (code, signal) => resolveResult({ code, signal }));
});
clearInterval(ownerWatch);
if (escalation) clearTimeout(escalation);
if (result.error) console.error(result.error);
process.exitCode = result.code ?? 1;
