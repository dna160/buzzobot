'use client';

import { useEffect, useState } from 'react';
import { Download, FileText, Loader2, Save, Sparkles } from 'lucide-react';
import { Button, Card, CardBody, CardHeader } from '@tempo/ui';
import { BENCHMARK_LAYOUT, FUNNEL_STAGES, TEMPLATE_LABEL, type NorthStar } from '@tempo/core';
import { trpc } from '@/trpc/client';

/**
 * Benchmark editor + generate/download for the Template Report. Every value
 * here is either a target an AM types in for a real negotiated number, or
 * (via "Isi dari Peer Industri") a real average pulled live from comparable
 * accounts in Buzzohero's own database by `autoPopulate` — never invented.
 * `budget_pct` grades §2's funnel allocation the same way; `funnelAllocationStatus`
 * derives a ±10pp band around whatever's saved here, per client.
 */

interface MetricDef {
  objective: string;
  metric: string;
  label: string;
  direction: 'higher_is_better' | 'lower_is_better';
  /** Stored as a fraction (0.39) but shown/typed as a percent (39) — every percent-kind metric and the funnel budget ideals. */
  displayAsPercent?: boolean;
}

interface MetricGroup {
  key: string;
  title: string;
  defs: MetricDef[];
}

const FUNNEL_STAGE_LABEL: Record<(typeof FUNNEL_STAGES)[number], string> = {
  awareness: 'Awareness (TOF)',
  consideration: 'Consideration (MOF)',
  conversion: 'Conversion (BOF)',
};

/** The editor's groups for one north star: its own benchmark grid (BENCHMARK_LAYOUT) plus the funnel budget ideals every north star shares. */
function groupsFor(northStar: NorthStar): MetricGroup[] {
  const grid: MetricGroup[] = BENCHMARK_LAYOUT[northStar].map((section) => ({
    key: section.objective,
    title: section.title,
    defs: section.metrics.map((m) => ({
      objective: m.objective,
      metric: m.metric,
      label: m.label,
      direction: m.direction,
      displayAsPercent: m.kind === 'percent',
    })),
  }));
  const funnel: MetricGroup = {
    key: 'funnel',
    title: 'Proporsi Budget Funnel (% ideal)',
    defs: FUNNEL_STAGES.map((stage) => ({
      objective: stage,
      metric: 'budget_pct',
      label: FUNNEL_STAGE_LABEL[stage],
      direction: 'higher_is_better' as const,
      displayAsPercent: true,
    })),
  };
  return [funnel, ...grid];
}

const TEMPLATE_OPTIONS: Array<{ value: NorthStar; description: string }> = [
  { value: 'shop', description: 'Spend, GMV, ROI/ROAS — TTAM + GMV Max, produk andalan, creative.' },
  { value: 'vtr', description: 'Reach, frequency, CPM, video retention (VTR/completion), engagement.' },
  { value: 'app_install', description: 'Install, CPI, install rate, registrasi & cost per registration.' },
];

export function TemplateReportPanel({ slug, clientNorthStar }: { slug: string; clientNorthStar: NorthStar }) {
  const utils = trpc.useUtils();
  // The template is the AM's explicit choice per report — it starts on the
  // client's own north star but is never forced to it. It drives the benchmark
  // grid below, the industry-peer averaging, and which report gets generated.
  const [template, setTemplate] = useState<NorthStar>(clientNorthStar);
  const groups = groupsFor(template);
  const allDefs = groups.flatMap((g) => g.defs);
  const query = trpc.reportBenchmark.list.useQuery({ slug });
  const [values, setValues] = useState<Record<string, string>>({});
  const [downloadState, setDownloadState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [pdfState, setPdfState] = useState<'idle' | 'loading' | 'error'>('idle');
  // Blank means "default trailing 30 days" — both must be set together to
  // request a specific range; the prior comparison period automatically
  // matches whatever length is chosen (see the route's own doc comment).
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  // 'industry' grades against the saved benchmark targets above; 'previous'
  // grades against the prior window of equal length (e.g. Sept 1–30 vs the 30
  // days before it). Both are always available — this only picks one per run.
  const [benchmarkMode, setBenchmarkMode] = useState<'industry' | 'previous'>('industry');

  useEffect(() => {
    if (!query.data) return;
    const next: Record<string, string> = {};
    for (const row of query.data) {
      next[`${row.objective}:${row.metric}`] = String(row.targetValue);
    }
    setValues(next);
  }, [query.data]);

  const save = trpc.reportBenchmark.save.useMutation({
    onSuccess: () => utils.reportBenchmark.list.invalidate({ slug }),
  });

  const onSaveAll = () => {
    for (const def of allDefs) {
      const key = `${def.objective}:${def.metric}`;
      const raw = values[key];
      const parsed = raw === undefined || raw === '' ? null : Number(raw);
      if (parsed === null || Number.isNaN(parsed)) continue;
      save.mutate({ slug, objective: def.objective, metric: def.metric, targetValue: parsed, comparisonDirection: def.direction });
    }
  };

  // "Isi dari Peer Industri (AI)" — resolves this client's industry, averages
  // real comparable accounts on THIS north star's metric grid, and pre-fills
  // the draft above (does NOT save on its own). The AM reviews the numbers and
  // peer list, then clicks "Simpan Benchmark" same as any manually typed value.
  const autoPopulate = trpc.reportBenchmark.autoPopulate.useMutation();

  const onAutoPopulate = () => {
    autoPopulate.mutate(
      { slug, northStar: template },
      {
        onSuccess: (result) => {
          setValues((v) => {
            const next = { ...v };
            for (const entry of result.entries) {
              next[`${entry.objective}:${entry.metric}`] = String(entry.value);
            }
            return next;
          });
        },
      },
    );
  };

  const buildReportParams = (): URLSearchParams => {
    const params = new URLSearchParams();
    if (rangeStart && rangeEnd) {
      params.set('start', rangeStart);
      params.set('end', rangeEnd);
    }
    params.set('template', template);
    if (benchmarkMode === 'previous') params.set('benchmark', 'previous');
    return params;
  };

  // Primary action — matches what an external site's "Generate Report" button
  // gets (the endpoint defaults to format=html): fetch the report HTML and
  // show it, rather than downloading a file. The tab is opened synchronously
  // on click, before the (slow — 30-150s, LM Studio writes 6 sections with no
  // placeholder fallback) fetch, so the browser doesn't treat it as an
  // unrequested popup and block it.
  const onGenerateHtml = async () => {
    const win = window.open('', '_blank');
    setDownloadState('loading');
    try {
      const params = buildReportParams();
      const res = await fetch(`/api/reports/${slug}/template-report?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Report request failed (${res.status})`);
      const html = await res.text();
      if (win) {
        win.document.open();
        win.document.write(html);
        win.document.close();
      } else {
        // Popup blocked — fall back to a downloadable .html file instead of losing the result.
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${slug}-tiktok-ads-performance-report.html`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
      setDownloadState('idle');
    } catch (err) {
      console.error(err);
      win?.close();
      setDownloadState('error');
      setTimeout(() => setDownloadState('idle'), 3000);
    }
  };

  // Secondary action — the original downloadable-file behavior, now requested explicitly via format=pdf.
  const onDownloadPdf = async () => {
    setPdfState('loading');
    try {
      const params = buildReportParams();
      params.set('format', 'pdf');
      const res = await fetch(`/api/reports/${slug}/template-report?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Report request failed (${res.status})`);
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `${slug}-tiktok-ads-performance-report.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setPdfState('idle');
    } catch (err) {
      console.error(err);
      setPdfState('error');
      setTimeout(() => setPdfState('idle'), 3000);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-primary">Template laporan</h2>
          <p className="mt-1 text-xs text-muted">
            Pilih template yang ingin dibuat. Template menentukan metric di kartu benchmark dan di
            laporan.
          </p>
        </CardHeader>
        <CardBody>
          <div className="space-y-2" role="radiogroup" aria-label="Template laporan">
            {TEMPLATE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                  template === opt.value ? 'border-accent bg-surface-hover' : 'border-border'
                }`}
              >
                <input
                  type="radio"
                  name="report-template"
                  className="mt-1"
                  checked={template === opt.value}
                  onChange={() => {
                    setTemplate(opt.value);
                    autoPopulate.reset();
                  }}
                />
                <span className="text-secondary">
                  {TEMPLATE_LABEL[opt.value]}
                  {opt.value === clientNorthStar ? (
                    <span className="ml-2 text-xs text-muted">(north star klien ini)</span>
                  ) : null}
                  <span className="block text-xs text-muted">{opt.description}</span>
                </span>
              </label>
            ))}
          </div>
          {template !== clientNorthStar ? (
            <p
              role="alert"
              className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400"
            >
              Peringatan: north star klien ini adalah <strong>{TEMPLATE_LABEL[clientNorthStar]}</strong>, tetapi
              template <strong>{TEMPLATE_LABEL[template]}</strong> dipilih. Beberapa metric bisa kosong
              (n/a) atau kurang relevan karena klien ini tidak dioptimasi untuk hasil tersebut.
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-primary">Benchmark targets</h2>
          <p className="mt-1 text-xs text-muted">
            Angka yang dinegosiasikan dengan brand, atau diisi dari rata-rata akun sejenis lewat
            tombol &quot;Isi dari Peer Industri&quot; di bawah. Kosongkan metric yang belum punya
            target; bagian benchmark itu akan tampil sebagai &quot;belum diatur&quot; di laporan.
          </p>
        </CardHeader>
        <CardBody>
          <div className="space-y-5">
            {groups.map(({ key: groupKey, title, defs }) => (
              <div key={groupKey}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  {title}
                </h3>
                <div className="space-y-2">
                  {defs.map((def) => {
                    const key = `${def.objective}:${def.metric}`;
                    const raw = values[key];
                    const displayValue =
                      def.displayAsPercent && raw !== undefined && raw !== '' && !Number.isNaN(Number(raw))
                        ? String(Number(raw) * 100)
                        : (raw ?? '');
                    return (
                      <label key={key} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-secondary">{def.label}</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="any"
                            className="w-28 rounded-md border border-border bg-surface px-2 py-1 text-right text-sm"
                            value={displayValue}
                            onChange={(e) => {
                              const typed = e.target.value;
                              const stored = def.displayAsPercent && typed !== '' && !Number.isNaN(Number(typed)) ? String(Number(typed) / 100) : typed;
                              setValues((v) => ({ ...v, [key]: stored }));
                            }}
                            placeholder="—"
                          />
                          {def.displayAsPercent ? <span className="text-xs text-muted">%</span> : null}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {autoPopulate.error ? (
            <p className="mt-4 text-xs text-red-500">
              Gagal mengisi dari peer industri: {autoPopulate.error.message}
            </p>
          ) : null}

          {autoPopulate.data ? (
            <div className="mt-4 rounded-md border border-border bg-surface-hover p-3 text-xs">
              <p className="font-medium text-secondary">
                Industri: {autoPopulate.data.industry}{' '}
                <span className="font-normal text-muted">
                  ({autoPopulate.data.industrySource === 'own-account'
                    ? 'dari kategori akun klien sendiri'
                    : 'dipilih oleh Gemma dari daftar tetap'})
                </span>
              </p>
              {autoPopulate.data.peers.length === 0 ? (
                <p className="mt-1 text-muted">
                  Belum ada akun lain yang dikategorikan di industri ini di database Buzzohero.
                </p>
              ) : (
                <>
                  <p className="mt-1 text-muted">
                    {autoPopulate.data.peers.filter((p) => p.included).length} dari{' '}
                    {autoPopulate.data.peers.length} akun yang cocok punya data nyata (spend ≥ Rp10jt) dan
                    dipakai untuk rata-rata:
                  </p>
                  <ul className="mt-1 space-y-0.5 text-muted">
                    {autoPopulate.data.peers.map((p) => (
                      <li key={p.tiktokAdAccountId} className={p.included ? '' : 'opacity-50 line-through'}>
                        {p.name} — Rp{Math.round(p.spend).toLocaleString('id-ID')}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="mt-2 text-muted">
                Angka di atas sudah diisi ke form sebagai draft — cek dulu, lalu klik &quot;Simpan
                Benchmark&quot; untuk menyimpan.
              </p>
            </div>
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onAutoPopulate} disabled={autoPopulate.isPending}>
              {autoPopulate.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Isi dari Peer Industri (AI)
            </Button>
            <Button variant="secondary" size="sm" onClick={onSaveAll} disabled={save.isPending}>
              {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Simpan Benchmark
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-primary">Generate report</h2>
          <p className="mt-1 text-xs text-muted">
            Kosongkan tanggal untuk trailing 30 hari (default). Isi keduanya untuk periode
            spesifik — periode pembanding otomatis mengikuti panjang periode yang dipilih (mis.
            60 hari dibandingkan 60 hari sebelumnya), dinilai terhadap benchmark di atas, dengan
            enam bagian naratif ditulis oleh LM Studio.
          </p>
        </CardHeader>
        <CardBody>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-secondary">
              Dari
              <input
                type="date"
                className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
                value={rangeStart}
                onChange={(e) => setRangeStart(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-secondary">
              Sampai
              <input
                type="date"
                className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
                value={rangeEnd}
                onChange={(e) => setRangeEnd(e.target.value)}
              />
            </label>
            {rangeStart || rangeEnd ? (
              <button
                type="button"
                className="pb-1.5 text-xs text-muted underline hover:text-secondary"
                onClick={() => {
                  setRangeStart('');
                  setRangeEnd('');
                }}
              >
                Reset ke 30 hari
              </button>
            ) : null}
          </div>
          <fieldset className="mb-4 space-y-1.5 text-sm">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              Bandingkan dengan
            </legend>
            <label className="flex items-start gap-2 text-secondary">
              <input
                type="radio"
                name="benchmark-mode"
                className="mt-1"
                checked={benchmarkMode === 'industry'}
                onChange={() => setBenchmarkMode('industry')}
              />
              <span>
                Benchmark industri / target tersimpan
                <span className="block text-xs text-muted">Target di kartu &quot;Benchmark targets&quot; di atas.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-secondary">
              <input
                type="radio"
                name="benchmark-mode"
                className="mt-1"
                checked={benchmarkMode === 'previous'}
                onChange={() => setBenchmarkMode('previous')}
              />
              <span>
                Periode sebelumnya
                <span className="block text-xs text-muted">
                  Periode yang sama panjang tepat sebelum rentang yang dipilih (mis. 1–30 Sep dibandingkan 30 hari
                  sebelumnya). Target tersimpan tidak dipakai.
                </span>
              </span>
            </label>
          </fieldset>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={onGenerateHtml} disabled={downloadState === 'loading'}>
              {downloadState === 'loading' ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Generating… (bisa 1–3 menit)
                </>
              ) : downloadState === 'error' ? (
                'Retry'
              ) : (
                <>
                  <FileText size={14} /> Generate Report (HTML)
                </>
              )}
            </Button>
            <Button variant="secondary" size="sm" onClick={onDownloadPdf} disabled={pdfState === 'loading'}>
              {pdfState === 'loading' ? (
                <Loader2 size={14} className="animate-spin" />
              ) : pdfState === 'error' ? (
                'Retry'
              ) : (
                <>
                  <Download size={14} /> Unduh PDF
                </>
              )}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
