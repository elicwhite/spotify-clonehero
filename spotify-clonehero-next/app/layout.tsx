import './globals.css';
import type {Metadata} from 'next';
import {Inter} from 'next/font/google';
import ContextProviders from './ContextProviders';

const inter = Inter({subsets: ['latin']});

export const metadata: Metadata = {
  title: 'Clone Hero Library Update Manager',
  description: 'Manage updates to your Clone Hero charts',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-slate-50 dark:bg-slate-950 `}>
        <ContextProviders>{children}</ContextProviders>
      </body>
    </html>
  );
}
