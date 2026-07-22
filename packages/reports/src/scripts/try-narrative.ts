/** Exercise the narrative pipeline against the seeded database. */
import { getDb, getClientBySlug } from '@tempo/db';
import { buildHourlyReport } from '../hourly-model.js';

const { db } = getDb();
const client = await getClientBySlug(db, process.argv[2] ?? 'cimory');
if (!client) throw new Error('client not found');

const model = await buildHourlyReport(db, client, {
  generatedAt: new Date(),
  locale: 'en',
});
if (!model) throw new Error('no hourly data');

const n = model.narrative;
console.log(`source    : ${n.source}`);
console.log(`provider  : ${n.provider ?? '—'}  model: ${n.model ?? '—'}  attempts: ${n.attempts}`);
if (n.fallbackReason) console.log(`fallback  : ${n.fallbackReason}`);
console.log(`\nheadline  : ${n.narrative.headline}`);
console.log(`summary   : ${n.narrative.summaryProse.slice(0, 200)}`);
if (n.narrative.daypart) {
  console.log(`\ndaypart   : [${n.narrative.daypart.finding.title}] ${n.narrative.daypart.finding.body}`);
}
if (n.narrative.efficiency) {
  console.log(`efficiency: [${n.narrative.efficiency.finding.title}] ${n.narrative.efficiency.finding.body}`);
}
console.log(`\nrisks     : ${n.narrative.risks.length}`);
for (const r of n.narrative.risks.slice(0, 3)) {
  console.log(`  [${r.severity}] ${r.risk} → ${r.owner}`);
}
console.log(`confidence: ${n.narrative.confidence}`);
process.exit(0);
