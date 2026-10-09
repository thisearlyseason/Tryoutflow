// Defense in depth for the future isolated Linux runner. The container must also use network=none.
// Only its task-owned Next server on literal loopback:3112 is permitted. No backend is started.
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';

if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error('This capture guard requires the approved Linux amd64 runner.');
}
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof options === 'object' ? options.host : args[1];
  const port = typeof options === 'object' ? options.port : options;
  if (host !== '127.0.0.1' || Number(port) !== 3112) {
    throw new Error('Linux capture guard blocked a target outside the owned Next server.');
  }
  return originalConnect.apply(this, args);
};
const originalListen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  const options = args[0];
  const host = typeof options === 'object' ? options.host : args[1];
  const port = typeof options === 'object' ? options.port : options;
  if (host !== '127.0.0.1' || Number(port) !== 3112) {
    throw new Error('Linux capture guard permits only the owned Next listener.');
  }
  return originalListen.apply(this, args);
};
syncBuiltinESMExports();
