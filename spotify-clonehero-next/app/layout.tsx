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
import HeaderAuthControls from '@/components/HeaderAuthControls';
import {Suspense} from 'react';

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
          <nav className="border-b border-border/60 h-12 md:h-16 px-4 md:px-8">
            <div className="max-w-screen-xl flex flex-wrap items-center justify-between mx-auto h-full">
              <div className="flex flex-row gap-8">
                <Link
                  href="/"
                  className="flex items-center space-x-3 rtl:space-x-reverse">
                  <span className="self-center text-xl font-semibold whitespace-nowrap dark:text-white">
                    Music Charts Tools
                  </span>
                </Link>
                <Link href="/">
                  <Button variant="ghost" className="font-semibold">
                    <span className="">More Tools</span>
                  </Button>
                </Link>
              </div>

              <nav className="flex items-center">
                <Link
                  href="https://discord.gg/EDxu95B98s"
                  target="_blank"
                  rel="noreferrer">
                  <Button variant="ghost" size="icon" className="w-9 px-0">
                    <Icons.discord className="h-4 w-4" />
                    <span className="sr-only">Discord</span>
                  </Button>
                </Link>
                <Link
                  href="https://github.com/TheSavior/spotify-clonehero"
                  target="_blank"
                  rel="noreferrer">
                  <Button variant="ghost" size="icon" className="w-9 px-0">
                    <Icons.gitHub className="h-4 w-4" />
                    <span className="sr-only">GitHub</span>
                  </Button>
                </Link>
                <Suspense>
                  <HeaderAuthControls />
                </Suspense>
              </nav>
            </div>
          </nav>
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
