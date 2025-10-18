import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Covered Call Backtester',
  description: 'Sell-covered call strategy vs buy-and-hold — Next.js',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body className="min-h-screen bg-gradient-to-b from-slate-50 to-white text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
