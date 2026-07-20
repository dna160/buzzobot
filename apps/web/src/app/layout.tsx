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
    <html lang="en" data-theme="dark" className={`${inter.variable} ${jetbrains.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <TRPCProvider>
          <AppShell>{children}</AppShell>
        </TRPCProvider>
      </body>
    </html>
  );
}
