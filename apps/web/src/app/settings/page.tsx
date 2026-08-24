import type { Metadata } from 'next';
import { EngineHealthCard } from '@/components/settings/EngineHealthCard';

export const metadata: Metadata = {
  title: 'Settings · Tempo Insight Engine',
};

/** Workspace settings. Currently: the analytics engine that writes every deck. */
export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-primary">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          How Tempo generates client-facing decks, and whether the engine behind them is
          healthy.
        </p>
      </header>
      <EngineHealthCard />
    </div>
  );
}
