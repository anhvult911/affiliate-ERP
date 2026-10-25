import { connect } from "node:net";

/**
 * Pre-flight check for the account's proxy.
 *
 * Why this exists: if the proxy is down, Chromium silently falls back to the
 * host's own IP. For an account farm that is the worst possible outcome — the
 * account suddenly appears from a datacenter address, which is exactly the
 * pattern platforms use to link and ban accounts. Failing the attempt with a
 * clear message costs one queue cycle; posting from the wrong IP can cost the
 * account.
 */
export async function assertProxyReachable(proxyIp: string, timeoutMs = 4_000): Promise<void> {
  const [host, port] = proxyIp.split(":");

  if (!host || !port) {
    throw new Error(`Proxy must look like host:port[:user:pass], got "${proxyIp}"`);
  }

  const portNumber = Number(port);
  if (!Number.isInteger(portNumber) || portNumber <= 0 || portNumber > 65535) {
    throw new Error(`Proxy port is invalid: "${port}"`);
  }

  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const socket = connect({ host, port: portNumber });

  const timer = setTimeout(() => {
    socket.destroy();
    reject(new Error(`Proxy ${host}:${portNumber} did not answer within ${timeoutMs}ms.`));
  }, timeoutMs);

  socket.once("connect", () => {
    clearTimeout(timer);
    socket.end();
    resolve();
  });

  socket.once("error", (error) => {
    clearTimeout(timer);
    reject(new Error(`Proxy ${host}:${portNumber} is unreachable: ${error.message}`));
  });

  await promise;
}
