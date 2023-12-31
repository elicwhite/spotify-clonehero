import './globals.css';
import type {Metadata} from 'next';
import {Inter as FontSans} from 'next/font/google';
import ContextProviders from './ContextProviders';
import Link from 'next/link';
import {GoogleAnalytics} from '@next/third-parties/google';
import {cn} from '@/lib/utils';
import {Icons} from '@/components/icons';
import {Button} from '@/components/ui/button';

export const fontSans = FontSans({
  subsets: ['latin'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'Clone Hero Library Update Manager',
  description: 'Manage updates to your Clone Hero charts',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body
        className={cn(
          'bg-background flex flex-col h-screen font-sans antialiased',
          fontSans.variable,
        )}>
        <nav className="bg-white border-gray-200 dark:bg-gray-900">
          <div className="max-w-screen-xl flex flex-wrap items-center justify-between mx-auto p-4">
            <Link
              href="/"
              className="flex items-center space-x-3 rtl:space-x-reverse">
              <span className="self-center text-2xl font-semibold whitespace-nowrap dark:text-white">
                Clone Hero Chart Tools
              </span>
            </Link>

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
            </nav>
          </div>
        </nav>
        <main className="flex flex-col items-center align-center justify-between min-h-0 p-4">
          <ContextProviders>{children}</ContextProviders>
        </main>
        <GoogleAnalytics gaId="G-LEE7EDJH14" />
      </body>
    </html>
  );
}
