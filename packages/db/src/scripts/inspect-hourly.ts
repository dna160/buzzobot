/** Ad-hoc check of the intraday read-model against the seeded database. */
import { getDb } from '../client.js';
import { getClientBySlug } from '../repositories/dashboard.js';
import { getHourlyDashboard } from '../repositories/hourly.js';

const { db } = getDb();
const client = await getClientBySlug(db, process.argv[2] ?? 'cimory');
if (!client) throw new Error('client not found');

const d = await getHourlyDashboard(db, client);
if (!d) throw new Error('no hourly data');

const idr = (n: number | null) =>
  n === null ? 'n/a' : Math.round(n).toLocaleString('en-US');
const pct = (n: number | null) => (n === null ? 'n/a' : `${(n * 100).toFixed(2)}%`);

console.log(`client   ${d.client.name} (${d.client.currency}, ${d.client.timezone})`);
console.log(`dates    ${d.availableDates.join(', ')}`);
console.log(`showing  ${d.date}`);
console.log(
  `coverage hours ${d.coverage.firstHour}–${d.coverage.lastHour}` +
    ` | complete=${d.coverage.isComplete}` +
    ` | aggregated (not true hours): [${d.coverage.aggregatedHours
      .map((a) => `${a.hour}:00 spans ${a.spanHours}h`)
      .join(', ')}]`,
);
console.log(
  `totals   spend=${idr(d.totals.spend)}  impr=${idr(d.totals.impressions)}` +
    `  clicks=${idr(d.totals.clicks)}  CTR=${pct(d.totals.ctr)}  CPC=${idr(d.totals.cpc)}` +
    `  CPM=${idr(d.totals.cpm)}`,
);

console.log('\n-- hour by hour (true hours only) --');
console.log('hr        spend       impr    clicks      CTR      CPC      CPM   burn%  even%');
for (const h of d.hours) {
  const p = d.pacing.find((x) => x.hour === h.hour)!;
  console.log(
    `${String(h.hour).padStart(2, '0')}  ${idr(h.spend).padStart(11)}` +
      `${idr(h.impressions).padStart(11)}${idr(h.clicks).padStart(10)}` +
      `${pct(h.ctr).padStart(9)}${idr(h.cpc).padStart(9)}${idr(h.cpm).padStart(9)}` +
      `${(p.share * 100).toFixed(0).padStart(7)}%${(p.evenShare * 100).toFixed(0).padStart(6)}%`,
  );
}

console.log('\n-- day over day, spend by hour --');
const hoursAxis = [...new Set(d.dayOverDay.flatMap((s) => s.points.map((p) => p.hour)))].sort(
  (a, b) => a - b,
);
console.log('hr  ' + d.dayOverDay.map((s) => s.date.slice(5).padStart(13)).join(''));
for (const hr of hoursAxis) {
  const cells = d.dayOverDay.map((s) => {
    const p = s.points.find((x) => x.hour === hr);
    return (p ? idr(p.spend) : '·').padStart(13);
  });
  console.log(`${String(hr).padStart(2, '0')}  ${cells.join('')}`);
}

console.log('\n-- campaigns (selected date) --');
for (const c of d.campaigns) {
  console.log(
    `\n  ${c.name}  [${c.objective}]\n` +
      `    spend=${idr(c.totals.spend)}  impr=${idr(c.totals.impressions)}` +
      `  clicks=${idr(c.totals.clicks)}  CTR=${pct(c.totals.ctr)}  CPC=${idr(c.totals.cpc)}` +
      `  hours=${c.hours.length}`,
  );
  for (const a of c.adgroups) {
    console.log(
      `      └ ${a.name.slice(0, 44).padEnd(44)} spend=${idr(a.totals.spend).padStart(11)}` +
        `  CTR=${pct(a.totals.ctr).padStart(7)}  hours=${a.hours.length}`,
    );
  }
}
process.exit(0);
