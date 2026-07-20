import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/** The application chrome: fixed sidebar + sticky topbar + scrolling content. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <Sidebar />
      <div className="lg:pl-[248px]">
        <Topbar />
        <main className="mx-auto w-full max-w-content px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
