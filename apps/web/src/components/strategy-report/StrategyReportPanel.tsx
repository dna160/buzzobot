'use client';

import { useEffect, useState } from 'react';
import { Check, Clock, Download, FileText, Loader2, RotateCcw, Save, Sparkles } from 'lucide-react';
import { Button, Card, CardBody, CardHeader } from '@tempo/ui';
import { trpc } from '@/trpc/client';

/**
 * The Strategy Report panel (PRD §9.3): settings, generate, and the action
 * loop. Every rule a setting must satisfy lives in `@tempo/reports`
 * (`parseStrategySpec`); this form only collects values and shows the 422's
 * field messages when the server refuses one.
 */

const STAGE_LABEL: Record<string, string> = {
  acc: 'ACC (semua tahap)',
  awareness: 'Awareness',
  consideration: 'Consideration',
  conversion: 'Conversion',
};
const METRIC_LABEL: Record<string, string> = {
  impressions: 'Impresi',
  engagements: 'Interaksi',
  video_views_p100: 'Tontonan penuh',
  video_views_6s: 'Tontonan 6 detik',
  search_volume: 'Volume pencarian (paket Full)',
  likes: 'Suka',
  comments: 'Komentar',
  shares: 'Dibagikan',
  clicks: 'Klik',
  product_card_clicks: 'Klik kartu produk',
};
const GOAL_LABEL: Record<string, string> = {
  rank: 'Peringkat tahap',
  share: 'Pangsa kategori',
  size_ratio: 'Ukuran tahap berikutnya (%)',
  cost_per_new: 'Biaya per 1.000 audiens baru (Rp)',
};
const VERDICT: Record<string, string> = { worked: 'Berhasil', weak: 'Lemah', failed: 'Gagal', running: 'Berjalan', snoozed: 'Nanti dulu', proposed: 'Diusulkan' };

const input = 'w-full rounded-md border border-border bg-surface px-2 py-1 text-sm';
const label = 'block text-xs font-medium text-muted';

type Goal = { kind: string; stage: string | null; metric: string | null; value: number; deadline: string } | null;

export function StrategyReportPanel({ slug }: { slug: string }) {
  const utils = trpc.useUtils();
  const spec = trpc.strategySpec.get.useQuery({ slug });
  const actions = trpc.strategyAction.list.useQuery({ slug, limit: 12 });
  const save = trpc.strategySpec.save.useMutation({ onSuccess: () => utils.strategySpec.get.invalidate({ slug }) });
  const reset = trpc.strategySpec.reset.useMutation({ onSuccess: () => utils.strategySpec.get.invalidate({ slug }) });
  const accept = trpc.strategyAction.accept.useMutation({ onSuccess: () => utils.strategyAction.list.invalidate({ slug }) });
  const snooze = trpc.strategyAction.snooze.useMutation({ onSuccess: () => utils.strategyAction.list.invalidate({ slug }) });

  const [classOverride, setClassOverride] = useState<'' | 'brand' | 'shop'>('');
  const [account, setAccount] = useState<string>('');
  const [goalKind, setGoalKind] = useState<string>('');
  const [goalStage, setGoalStage] = useState<string>('consideration');
  const [goalMetric, setGoalMetric] = useState<string>('impressions');
  const [goalValue, setGoalValue] = useState<string>('');
  const [goalDeadline, setGoalDeadline] = useState<string>('');
  const [creatorFee, setCreatorFee] = useState<string>('');
  const [bgcCost, setBgcCost] = useState<string>('');
  const [days, setDays] = useState(28);
  const [tier, setTier] = useState<'instant' | 'full'>('instant');
  const [preview, setPreview] = useState<'' | 'brand' | 'shop'>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const warm = trpc.strategySpec.warm.useQuery({ slug, days }, { enabled: !!slug });

  useEffect(() => {
    const s = spec.data?.spec;
    if (!s) return;
    setClassOverride((s.reportClassOverride ?? '') as '' | 'brand' | 'shop');
    setAccount(s.ttmsAccountId ?? '');
    const g = s.goal as Goal;
    setGoalKind(g?.kind ?? '');
    if (g?.stage) setGoalStage(g.stage);
    if (g?.metric) setGoalMetric(g.metric);
    // Shares and size ratios are stored as fractions and typed as percents.
    setGoalValue(g ? String(g.kind === 'share' || g.kind === 'size_ratio' ? +(g.value * 100).toFixed(4) : g.value) : '');
    setGoalDeadline(g?.deadline ?? '');
    setCreatorFee(s.creatorFeeMonthly != null ? String(s.creatorFeeMonthly) : '');
    setBgcCost(s.bgcCostMonthly != null ? String(s.bgcCostMonthly) : '');
  }, [spec.data]);

  if (spec.isLoading) return <p className="text-sm text-muted">Memuat…</p>;
  if (spec.error) return <p className="text-sm text-red-500">{spec.error.message}</p>;
  const data = spec.data!;

  if (!data.eligible) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-secondary">
            Klien ini belum terhubung ke akun TikTok Market Scope. Strategy Report membutuhkan data TTMS (dihubungkan
            lewat portal Buzzohero, lalu disalin oleh sinkronisasi harian Tempo).
          </p>
        </CardBody>
      </Card>
    );
  }

  const stagesFor = (kind: string): readonly string[] =>
    kind === 'share' ? [] : ((data.goalOptions.stages as Record<string, readonly string[]>)[kind] ?? []);

  const onSave = () => {
    setError(null);
    const value = Number(goalValue);
    const goal = goalKind
      ? {
          kind: goalKind,
          stage: goalKind === 'share' ? null : goalStage,
          metric: goalKind === 'share' ? goalMetric : null,
          value: goalKind === 'share' || goalKind === 'size_ratio' ? value / 100 : value,
          deadline: goalDeadline,
        }
      : null;
    save.mutate(
      {
        slug,
        spec: {
          ttmsAccountId: account || null,
          reportClassOverride: classOverride || null,
          goal,
          creatorFeeMonthly: creatorFee ? Number(creatorFee) : null,
          bgcCostMonthly: bgcCost ? Number(bgcCost) : null,
        },
      },
      { onError: (e) => setError(e.message) },
    );
  };

  const reportUrl = (format: 'html' | 'pdf') => {
    const q = new URLSearchParams({ format, tier, days: String(days) });
    if (preview) q.set('class', preview);
    return `/api/reports/${encodeURIComponent(slug)}/strategy-report?${q.toString()}`;
  };

  /**
   * Full tier without a class preview runs asynchronously (PRD §9.4): start the
   * run, poll until the engine has finished and the PDF is stored, then fetch
   * the stored file. Returns the URL to download.
   */
  const runFullTier = async (): Promise<string> => {
    const base = `/api/reports/${encodeURIComponent(slug)}/strategy-report/full`;
    const started = await fetch(`${base}?days=${days}`, { method: 'POST' });
    if (!started.ok) throw new Error(await started.text());
    const { runId } = (await started.json()) as { runId: string };
    const t0 = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 4000));
      const poll = await fetch(`${base}?runId=${encodeURIComponent(runId)}`);
      const body = (await poll.json()) as { status: string; downloadUrl?: string; error?: string };
      if (body.status === 'ready' && body.downloadUrl) return body.downloadUrl;
      if (body.status === 'failed') throw new Error(body.error ?? 'Tier penuh gagal');
      setProgress(`Tier penuh berjalan… ${Math.round((Date.now() - t0) / 1000)} detik`);
    }
  };

  /** Regenerate the stored full-tier report for this window without downloading it. */
  const runFullNow = async () => {
    setBusy('full');
    setError(null);
    try {
      await runFullTier();
      await warm.refetch();
      void utils.strategyAction.list.invalidate({ slug });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const download = async () => {
    setBusy('pdf');
    setError(null);
    setProgress(null);
    try {
      const url = tier === 'full' && !preview ? await runFullTier() : reportUrl('pdf');
      if (tier === 'full' && !preview) void warm.refetch();
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${slug}-tempo-strategy.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
      void utils.strategyAction.list.invalidate({ slug });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const rows = actions.data ?? [];
  const latestRun = rows.find((r) => r.status === 'proposed')?.runId;
  const proposals = rows.filter((r) => r.status === 'proposed' && r.runId === latestRun);
  const logged = rows.filter((r) => r.status !== 'proposed').slice(0, 6);
  const primary = data.accounts.find((a) => a.isPrimary) ?? data.accounts[0];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-primary">Pengaturan</h2>
          <p className="mt-1 text-xs text-muted">
            Akun TTMS: <span className="text-secondary">{primary?.brandName}</span>
            {primary?.vertical ? ` · ${primary.vertical}` : ''} · paket {primary?.isLite ? 'Lite' : 'Full'} · data s.d.{' '}
            {primary?.lastDataDate ?? '—'}
          </p>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={label}>Kelas laporan</span>
              <select className={input} value={classOverride} onChange={(e) => setClassOverride(e.target.value as '' | 'brand' | 'shop')}>
                <option value="">Otomatis (dari north star, porsi GMV Max, dan funnel)</option>
                <option value="brand">Brand-heavy — pangsa & peringkat dulu</option>
                <option value="shop">Shop-heavy — konversi & product card dulu</option>
              </select>
            </label>
            {data.accounts.length > 1 ? (
              <label className="block">
                <span className={label}>Akun TTMS untuk laporan</span>
                <select className={input} value={account} onChange={(e) => setAccount(e.target.value)}>
                  <option value="">Utama ({primary?.brandName})</option>
                  {data.accounts.map((a) => (
                    <option key={a.ttmsAccountId} value={a.ttmsAccountId}>
                      {a.brandName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="block">
              <span className={label}>Target</span>
              <select className={input} value={goalKind} onChange={(e) => setGoalKind(e.target.value)}>
                <option value="">Tanpa target</option>
                {data.goalOptions.kinds.map((k) => (
                  <option key={k} value={k}>
                    {GOAL_LABEL[k] ?? k}
                  </option>
                ))}
              </select>
            </label>
            {goalKind && goalKind !== 'share' ? (
              <label className="block">
                <span className={label}>Tahap</span>
                <select className={input} value={goalStage} onChange={(e) => setGoalStage(e.target.value)}>
                  {stagesFor(goalKind).map((s) => (
                    <option key={s} value={s}>
                      {STAGE_LABEL[s] ?? s}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {goalKind === 'share' ? (
              <label className="block">
                <span className={label}>Metrik</span>
                <select className={input} value={goalMetric} onChange={(e) => setGoalMetric(e.target.value)}>
                  {data.goalOptions.shareMetrics.map((m) => (
                    <option key={m} value={m}>
                      {METRIC_LABEL[m] ?? m}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {goalKind ? (
              <>
                <label className="block">
                  <span className={label}>
                    Nilai target{goalKind === 'rank' ? ' (#)' : goalKind === 'cost_per_new' ? ' (Rp)' : ' (%)'}
                  </span>
                  <input className={input} inputMode="decimal" value={goalValue} onChange={(e) => setGoalValue(e.target.value)} />
                </label>
                <label className="block">
                  <span className={label}>Tenggat</span>
                  <input className={input} type="date" value={goalDeadline} onChange={(e) => setGoalDeadline(e.target.value)} />
                </label>
              </>
            ) : null}
            <label className="block">
              <span className={label}>Biaya kreator per bulan (Rp)</span>
              <input className={input} inputMode="numeric" value={creatorFee} onChange={(e) => setCreatorFee(e.target.value)} placeholder="tidak diketahui" />
            </label>
            <label className="block">
              <span className={label}>Biaya produksi konten BGC per bulan (Rp)</span>
              <input className={input} inputMode="numeric" value={bgcCost} onChange={(e) => setBgcCost(e.target.value)} placeholder="tidak diketahui" />
            </label>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button onClick={onSave} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Simpan
            </Button>
            <Button variant="ghost" onClick={() => reset.mutate({ slug })} disabled={reset.isPending || !data.isStored}>
              <RotateCcw className="h-4 w-4" /> Kembalikan ke bawaan
            </Button>
            {data.updatedAt ? <span className="text-xs text-muted">Disimpan {new Date(data.updatedAt).toLocaleString('id-ID')}</span> : null}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-primary">Buat laporan</h2>
          <p className="mt-1 text-xs text-muted">
            Tier instan ditulis dari templat tanpa model (≤ 10 detik). Tier penuh memakai agen dan model lokal (hingga ~10
            menit); hasilnya disimpan dan dipakai ulang.
          </p>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="block">
              <span className={label}>Periode (hari)</span>
              <select className={input} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {[14, 28, 56].map((d) => (
                  <option key={d} value={d}>
                    {d} hari terakhir
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={label}>Tier</span>
              <select className={input} value={tier} onChange={(e) => setTier(e.target.value as 'instant' | 'full')}>
                <option value="instant">Instan</option>
                <option value="full">Penuh</option>
              </select>
            </label>
            <label className="block">
              <span className={label}>Pratinjau kelas</span>
              <select className={input} value={preview} onChange={(e) => setPreview(e.target.value as '' | 'brand' | 'shop')}>
                <option value="">Sesuai pengaturan</option>
                <option value="brand">Brand-heavy</option>
                <option value="shop">Shop-heavy</option>
              </select>
            </label>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button variant="secondary" onClick={() => window.open(reportUrl('html'), '_blank', 'noopener')}>
              <FileText className="h-4 w-4" /> Lihat HTML
            </Button>
            <Button onClick={download} disabled={busy === 'pdf'}>
              {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Unduh PDF
            </Button>
            <Button variant="ghost" onClick={runFullNow} disabled={busy !== null}>
              {busy === 'full' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Jalankan tier penuh
            </Button>
            {progress ? <span className="text-xs text-muted">{progress}</span> : null}
            {!progress && warm.data ? (
              <span className="rounded bg-surface-alt px-2 py-0.5 text-xs text-secondary">
                Dibuat {new Date(warm.data.generatedAt).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · tier penuh
              </span>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-primary">Tindakan</h2>
          <p className="mt-1 text-xs text-muted">
            Terima keputusan dari laporan terakhir untuk mulai mengukurnya; laporan berikutnya menilai hasilnya terhadap
            kategori pada periode yang sama.
          </p>
        </CardHeader>
        <CardBody>
          {proposals.length === 0 ? (
            <p className="text-sm text-muted">Belum ada keputusan baru. Buat laporan untuk mendapatkan usulan.</p>
          ) : (
            <ul className="space-y-3">
              {proposals.map((p) => {
                const a = p.actionJson as { rank: number; priority: string; copy?: { langkah?: string; gagal_jika?: string } };
                return (
                  <li key={p.id} className="rounded-md border border-border p-3">
                    <div className="text-xs text-muted">
                      Keputusan {a.rank} · {a.priority}
                    </div>
                    <div className="text-sm font-medium text-secondary">{a.copy?.langkah}</div>
                    <div className="mt-1 text-xs text-muted">Gagal jika: {a.copy?.gagal_jika}</div>
                    <div className="mt-2 flex gap-2">
                      <Button onClick={() => accept.mutate({ slug, id: p.id })} disabled={accept.isPending}>
                        <Check className="h-4 w-4" /> Terima
                      </Button>
                      <Button variant="ghost" onClick={() => snooze.mutate({ slug, id: p.id })} disabled={snooze.isPending}>
                        <Clock className="h-4 w-4" /> Nanti dulu
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {logged.length ? (
            <table className="mt-4 w-full text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="py-1">Mulai</th>
                  <th className="py-1">Tindakan</th>
                  <th className="py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {logged.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="py-1">{l.startedAt ?? '—'}</td>
                    <td className="py-1">{(l.actionJson as { copy?: { langkah?: string } }).copy?.langkah}</td>
                    <td className="py-1">{VERDICT[l.status] ?? l.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {error ? <p className="mt-3 text-xs text-red-500">{error}</p> : null}
        </CardBody>
      </Card>
    </div>
  );
}
