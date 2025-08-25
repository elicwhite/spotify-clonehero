import './globals.css';
import type {Metadata} from 'next';
import {Inter as FontSans} from 'next/font/google';
import ContextProviders from './ContextProviders';
import Link from 'next/link';
import {GoogleAnalytics} from '@next/third-parties/google';
import {cn} from '@/lib/utils';
import {Icons} from '@/components/icons';
import {Button} from '@/components/ui/button';
import {Toaster} from 'sonner';
import GlobalHeader from '@/components/GlobalHeader';

const fontSans = FontSans({
  subsets: ['latin'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'Music Charts Tools',
  description: 'Tools to manage Clone Hero charts',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body
        className={cn(
          'bg-background flex flex-col h-screen font-sans antialiased',
          fontSans.variable,
        )}>
          <ContextProviders>
            <GlobalHeader />
              <main className="flex flex-col flex-1 items-center align-center min-h-0 p-4">
                  {children}
              </main>
          </ContextProviders>
        <Toaster />
        <GoogleAnalytics gaId="G-LEE7EDJH14" />
      </body>
    </html>
  );
}
