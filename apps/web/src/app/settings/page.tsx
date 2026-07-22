import type { Metadata } from 'next';
import { ReportAiSettings } from '@/components/settings/ReportAiSettings';

export const metadata: Metadata = {
  title: 'Settings · Tempo Insight Engine',
};

/** Workspace settings. Currently: the report AI (LLM) connection. */
export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-primary">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Configure how Tempo generates client-facing reports.
        </p>
      </header>
      <ReportAiSettings />
    </div>
  );
}
