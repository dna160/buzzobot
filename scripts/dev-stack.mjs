#!/usr/bin/env node
/**
 * `pnpm stack` — run Tempo LM (apps/web) and the Tempo Intelligence Engine
 * (tempo-engine/) together, with the web app wired to the engine.
 *
 * The same two processes `ecosystem.config.cjs` runs under PM2, minus the
 * crons, in one foreground terminal: the engine starts first, the web app
 * starts once `GET /healthz` answers, and it gets `TEMPO_ENGINE_URL` pointing
 * at that engine explicitly (process env wins over the root `.env`, see
 * apps/web/next.config). Ctrl+C stops both.
 *
 * Flags: --web-port 3001  --engine-port 8001  --engine-host 127.0.0.1
 * Port 3000 is refused: it belongs to other systems on this machine.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const webPort = Number(flag('web-port', '3001'));
const enginePort = Number(flag('engine-port', '8001'));
const engineHost = flag('engine-host', '127.0.0.1');
const engineUrl = `http://${engineHost}:${enginePort}`;

const color = { engine: '\x1b[35m', web: '\x1b[36m', stack: '\x1b[33m', reset: '\x1b[0m' };
const log = (tag, line) => console.log(`${color[tag]}[${tag}]${color.reset} ${line}`);

function fail(message) {
  log('stack', `\x1b[31m${message}\x1b[0m`);
  process.exit(1);
}

if (webPort === 3000 || enginePort === 3000) fail('Port 3000 is reserved — pick another port.');

const python = resolve(
  root,
  'tempo-engine',
  process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
);
const nextBin = resolve(root, 'apps/web/node_modules/next/dist/bin/next');
if (!existsSync(python)) fail(`No engine venv at ${python} — run \`uv sync\` in tempo-engine/.`);
if (!existsSync(nextBin)) fail('Next.js is not installed — run `pnpm install`.');

function portInUse(port, host) {
  return new Promise((done) => {
    const socket = net.connect({ port, host });
    socket.once('connect', () => (socket.destroy(), done(true)));
    socket.once('error', () => done(false));
  });
}

const children = [];

function run(tag, command, args, options) {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  const pipe = (stream) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) log(tag, line);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => {
    log(tag, `exited (${code ?? 'signal'})`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  log('stack', 'stopping…');
  for (const child of children) {
    if (child.exitCode !== null) continue;
    // Next and uvicorn both fork workers; kill the whole tree.
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  }
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function waitForEngine(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (stopping) return false;
    try {
      const response = await fetch(`${engineUrl}/healthz`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return response.json();
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

if (await portInUse(webPort, '127.0.0.1')) {
  fail(`Port ${webPort} is already in use (is PM2's tempo-web running? \`pm2 stop tempo-web\`).`);
}

if (await portInUse(enginePort, engineHost)) {
  log('stack', `An engine is already listening on ${engineUrl} — reusing it.`);
} else {
  log('stack', `starting tempo-engine on ${engineUrl}`);
  run('engine', python, ['scripts/run_api.py', '--host', engineHost, '--port', String(enginePort)], {
    cwd: resolve(root, 'tempo-engine'),
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });
}

const health = await waitForEngine();
if (!health) fail(`tempo-engine did not answer ${engineUrl}/healthz within 60s.`);
log(
  'stack',
  `engine healthy (db: ${health.db ?? 'unknown'}) — starting Tempo LM on http://localhost:${webPort}`,
);
if (health.db === false) log('stack', 'warning: engine cannot reach its database (TEMPO_ENGINE_DATABASE_URL).');

run('web', process.execPath, [nextBin, 'dev', '-p', String(webPort)], {
  cwd: resolve(root, 'apps/web'),
  env: { ...process.env, PORT: String(webPort), TEMPO_ENGINE_URL: engineUrl },
});
