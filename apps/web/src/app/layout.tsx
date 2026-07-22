import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import '@tempo/ui/styles.css';
import './globals.css';
import { TRPCProvider } from '@/trpc/client';
import { AppShell } from '@/components/app-shell/AppShell';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Tempo Insight Engine',
  description: 'TikTok performance analytics for agencies and their clients.',
};

// Prevent a theme flash before hydration by setting data-theme from storage.
const themeInitScript = `
(function(){try{var t=localStorage.getItem('tempo-theme')||'dark';document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning on <html>: themeInitScript intentionally
    // rewrites data-theme from localStorage before React hydrates, so the
    // server's "dark" default legitimately differs from the client for anyone
    // on the light theme. Without this, every light-theme load logs a
    // hydration mismatch.
    //
    // …and on <body>: browser extensions commonly stamp their own attributes
    // onto it before hydration. The app sets no body attributes of its own, so
    // nothing real is being masked. The flag applies only to these elements'
    // own attributes, not to the tree beneath them.
    <html
      lang="en"
      data-theme="dark"
      className={`${inter.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body suppressHydrationWarning>
        <TRPCProvider>
          <AppShell>{children}</AppShell>
        </TRPCProvider>
      </body>
    </html>
  );
}
