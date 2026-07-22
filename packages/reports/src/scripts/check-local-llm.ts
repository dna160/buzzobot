/**
 * Preflight doctor for a local LLM (LM Studio and other OpenAI-compatible
 * servers). Answers the first question a local setup raises — "is the server
 * up and serving my model?" — without touching the database or the full report
 * pipeline. Run it before `try:narrative`.
 *
 *   pnpm --filter @tempo/reports check:local-llm
 *
 * The actual checks live in `narrative/probe.ts` so this CLI and the Settings
 * page's "Test connection" button share one implementation. Exit code is 0 only
 * when all checks pass, so it also works as a CI gate.
 */
import { loadNarrativeConfig } from '../narrative/provider.js';
import { probeLocalLlm } from '../narrative/probe.js';

const RESET = '\x1b[0m';
const c = (code: string, s: string) => `${code}${s}${RESET}`;
const ok = (s: string) => c('\x1b[32m', s); // green
const bad = (s: string) => c('\x1b[31m', s); // red
const warn = (s: string) => c('\x1b[33m', s); // yellow
const dim = (s: string) => c('\x1b[90m', s); // grey

const GLYPH = { pass: ok('✓'), warn: warn('!'), fail: bad('✗') } as const;

const config = loadNarrativeConfig();

console.log(`\nLocal LLM preflight`);
console.log(dim(`  base URL   : ${config.baseUrl}`));
console.log(dim(`  model      : ${config.model}`));
console.log(dim(`  provider   : ${config.provider}`));
if (config.provider !== 'lmstudio' && config.provider !== 'openai-compatible') {
  console.log(
    GLYPH.warn,
    warn(`REPORT_NARRATIVE_PROVIDER is '${config.provider}', so reports will NOT use this server.`),
  );
  console.log(dim(`      Set REPORT_NARRATIVE_PROVIDER=lmstudio to route reports through it.`));
  console.log(dim(`      Checking the endpoint anyway…`));
}
console.log();

const result = await probeLocalLlm({
  baseUrl: config.baseUrl,
  model: config.model,
  timeoutMs: config.timeoutMs,
  apiKey: process.env.REPORT_NARRATIVE_API_KEY,
});

for (const step of result.steps) {
  console.log(GLYPH[step.status], step.status === 'pass' ? step.detail : warnOrBad(step));
}

function warnOrBad(step: { status: 'pass' | 'warn' | 'fail'; detail: string }): string {
  return step.status === 'warn' ? warn(step.detail) : bad(step.detail);
}

if (result.ok) {
  console.log(ok(`\nLocal LLM is ready. Run \`pnpm --filter @tempo/reports try:narrative\` next.\n`));
  process.exit(0);
}
console.log(bad(`\nPreflight failed — see the ✗ above.\n`));
process.exit(1);
