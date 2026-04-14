import './globals.css';
import type { ReactNode } from 'react';

import { t } from '../lib/i18n';

export const metadata = {
  title: t('app.title'),
  description: t('app.description'),
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

