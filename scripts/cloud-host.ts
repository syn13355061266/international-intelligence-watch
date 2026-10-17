// One small cloud container runs the web, internal API and worker; PostgreSQL stays separate.
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

export function cloudEnvironment(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const port = Number(input.PORT || input.WEB_PORT || 3000);
  const apiPort = Number(input.API_PORT || (port === 3001 ? 3002 : 3001));
  if (![port, apiPort].every(value => Number.isInteger(value) && value > 0 && value < 65536) || port === apiPort) {
    throw new Error('Web and internal API ports must be valid and different');
  }
  // Local proxy addresses cannot work in a remote container. Configure a cloud-reachable proxy explicitly.
  for (const name of ['MODEL_PROXY_URL', 'EGRESS_PROXY_URL']) {
    if (input[name] && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(input[name]!).hostname)) {
      throw new Error(`${name} points at this computer; omit it for cloud deployment`);
    }
  }
  const siteUrl = input.SITE_URL || (input.RAILWAY_PUBLIC_DOMAIN ? `https://${input.RAILWAY_PUBLIC_DOMAIN}` : undefined);
  return {
    ...input,
    NODE_ENV: 'production',
    WEB_HOST: '0.0.0.0', WEB_PORT: String(port),
    API_HOST: '127.0.0.1', API_PORT: String(apiPort), API_BASE_URL: `http://127.0.0.1:${apiPort}`,
    LOCAL_ROUTER_URL: `http://127.0.0.1:${port}`, TRUST_PROXY: 'true',
    ...(siteUrl ? { SITE_URL: siteUrl.replace(/\/+$/, '') } : {}),
  };
}

export async function startCloudHost(input = process.env): Promise<void> {
  const env = cloudEnvironment(input);
  const children = new Set<ChildProcess>();
  let stopping = false;
  const stop = async (code: number) => {
    if (stopping) return;
    stopping = true;
    console.log(JSON.stringify({ level: 'info', msg: 'cloud host stopping' }));
    const exits = [...children].map(child => new Promise<void>(resolve => {
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
    }));
    // Worker gives in-flight model calls up to 195 seconds to settle their receipts.
    const timeout = setTimeout(() => {
      for (const child of children) child.kill('SIGKILL');
      process.exit(code);
    }, 205_000);
    await Promise.all(exits);
    clearTimeout(timeout);
    process.exit(code);
  };
  const launch = (role: string, script: string) => {
    const child = spawn(process.execPath, [script], { cwd: root, env, stdio: 'inherit', windowsHide: true });
    children.add(child);
    child.once('error', () => { console.error(`${role} failed to start`); void stop(1); });
    child.once('exit', code => {
      children.delete(child);
      if (!stopping) { console.error(`${role} exited (${code ?? 'signal'})`); void stop(1); }
    });
    return child;
  };
  process.once('SIGTERM', () => void stop(0));
  process.once('SIGINT', () => void stop(0));
  // An inherited IPC channel also permits controlled verification on Windows.
  process.on('message', message => { if (message === 'shutdown') void stop(0); });
  const setup = (script: string) => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd: root, env, stdio: 'inherit', windowsHide: true });
    children.add(child);
    child.once('error', reject);
    child.once('exit', code => { children.delete(child); code === 0 ? resolve() : reject(new Error(`${script} failed`)); });
  });
  try {
    await setup('scripts/migrate.ts');
    if (input.CLOUD_SEED === 'true') await setup('scripts/seed.ts');
    if (stopping) return;
    launch('api', 'apps/api/src/main.ts');
    const deadline = Date.now() + 60_000;
    while (!stopping) {
      const healthy = await fetch(`${env.API_BASE_URL}/api/health`, { signal: AbortSignal.timeout(2000) }).then(response => response.ok, () => false);
      if (healthy) break;
      if (Date.now() > deadline) throw new Error('Internal API did not become ready');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (stopping) return;
    launch('web', 'apps/web/server.ts');
    launch('worker', 'apps/worker/src/main.ts');
    console.log(JSON.stringify({ level: 'info', msg: 'cloud services started', port: env.WEB_PORT }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Cloud startup failed');
    await stop(1);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.env.CLOUD_ALL_IN_ONE === 'true') await startCloudHost();
  else await import(pathToFileURL(fileURLToPath(new URL('../apps/web/server.ts', import.meta.url))).href);
}
