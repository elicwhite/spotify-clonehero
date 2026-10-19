import './globals.css';
import type {Metadata} from 'next';
import {JetBrains_Mono as FontMono} from 'next/font/google';
import {cn} from '@musiccharts/core/utils';

// Wired into Tailwind's `font-mono` by the shared preset.
const fontMono = FontMono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: '__APP_NAME__',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body
        className={cn(
          'bg-background flex flex-col h-screen font-sans antialiased',
          fontMono.variable,
        )}>
        <main className="flex flex-col flex-1 min-h-0">{children}</main>
      </body>
    </html>
  );
}
