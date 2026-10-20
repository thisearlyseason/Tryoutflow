import { createServer } from 'node:http';

const server = createServer((_request, response) => {
  response.setHeader('x-marketing-gate-owner', process.env.MARKETING_GATE_NONCE ?? 'missing');
  response.end('owned server');
});

server.once('error', (error) => {
  process.stderr.write(`${error.code}\n`);
  process.exitCode = 1;
});
server.listen(Number(process.env.PORT ?? 0), '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener address');
  process.stdout.write(`- Local:         http://127.0.0.1:${address.port}\n`);
});

process.once('SIGTERM', () => server.close(() => process.exit(0)));
