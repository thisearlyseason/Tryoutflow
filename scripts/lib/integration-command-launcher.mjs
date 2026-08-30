import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const [commandJson, goPath, nonce] = process.argv.slice(2);
const command = JSON.parse(commandJson ?? 'null');
if (!Array.isArray(command) || command.length === 0 || command.some((v) => typeof v !== 'string')) {
  throw new Error('integration launcher requires a command');
}
if (!goPath || !/^[0-9a-f]{32}$/u.test(nonce ?? '')) {
  throw new Error('integration launcher requires a private capability');
}

while (!existsSync(goPath)) await new Promise((resolve) => setTimeout(resolve, 10));
const [executable, ...args] = command;
const child = spawn(executable, args, { env: process.env, stdio: 'inherit' });
const result = await new Promise((resolve) => {
  child.once('error', (error) => resolve({ code: 1, error }));
  child.once('close', (code, signal) => resolve({ code, signal }));
});
if (result.error) console.error(result.error);
const signals = { SIGINT: 2, SIGTERM: 15, SIGKILL: 9 };
process.exitCode = result.code ?? (result.signal ? 128 + (signals[result.signal] ?? 0) : 1);
