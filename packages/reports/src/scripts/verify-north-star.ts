/**
 * Ad-hoc verification: generate a real hourly report for each seeded client
 * and check that the north-star branching actually took effect — no VTR
 * leakage into a conversion client's report, and vice versa. Not a unit test;
 * exercises the real DB, the real narrative pipeline, and the real renderer
 * end to end. Prints a PASS/FAIL summary and writes each HTML report to
 * scratchpad for manual inspection.
 */
import { writeFileSync } from 'node:fs';
import { getDb, getClientBySlug } from '@tempo/db';
import { buildHourlyReport } from '../hourly-model.js';
import { renderHourlyReportHtml } from '../hourly-render.js';

const SCRATCH = 'C:/Users/User/AppData/Local/Temp/claude/D--Tempo-LM/bd58ee88-ed3e-48d4-8d2e-72c9924b91dc/scratchpad';

async function check(slug: string) {
  const { db } = getDb();
  const client = await getClientBySlug(db, slug);
  if (!client) {
    console.log(`[${slug}] SKIP — client not found`);
    return;
  }
  const model = await buildHourlyReport(db, client, { generatedAt: new Date(), locale: 'en' });
  if (!model) {
    console.log(`[${slug}] SKIP — no hourly data`);
    return;
  }
  const html = renderHourlyReportHtml(model);
  const path = `${SCRATCH}/report-${slug}.html`;
  writeFileSync(path, html, 'utf8');

  const isVtr = client.northStar === 'vtr';
  const hasVtrWord = /VTR|view-through/i.test(html);
  const hasConversionsWord = /Conversions|Installs/i.test(html);
  const hasRoas = /ROAS/i.test(html);

  console.log(`\n[${slug}] northStar=${client.northStar} windowTotals: spend=${model.windowTotals.spend} impressions=${model.windowTotals.impressions} conversions=${model.windowTotals.conversions} conversionValue=${model.windowTotals.conversionValue}`);
  console.log(`  narrative source: ${model.narrative.source}${model.narrative.fallbackReason ? ` (fallback: ${model.narrative.fallbackReason})` : ''}`);
  console.log(`  html written to: ${path}`);
  console.log(`  contains VTR wording        : ${hasVtrWord}  (expected ${isVtr})`);
  console.log(`  contains Conversions/Installs: ${hasConversionsWord}  (expected ${!isVtr})`);
  console.log(`  contains ROAS                : ${hasRoas}`);

  const ok = isVtr ? hasVtrWord && !hasConversionsWord : !hasVtrWord && hasConversionsWord;
  console.log(`  => ${ok ? 'PASS' : 'FAIL'}`);
}

for (const slug of ['cimory', 'laneige', 'treasury', 'bardi-jakarta']) {
  await check(slug);
}
process.exit(0);
