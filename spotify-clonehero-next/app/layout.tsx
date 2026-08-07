import './globals.css';
import type {Metadata} from 'next';
import {JetBrains_Mono as FontMono} from 'next/font/google';
import ContextProviders from './ContextProviders';
import {cn} from '@/lib/utils';
import {Toaster} from 'sonner';
import SiteHeader, {SiteMain} from '@/components/SiteChrome';
import SiteNav from '@/components/SiteNav';
import WebMCPInit from './WebMCPInit';
import WebMCPTools from './WebMCPTools';
import {getSiteUrl} from '@/lib/site-url';
import RegionAwareAnalytics from './RegionAwareAnalytics';

// The measurement voice on the landing pages: eyebrows, stat values,
// provenance, stage numbers. Wired into Tailwind's `font-mono`.
const fontMono = FontMono({
  subsets: ['latin'],
  variable: '--font-mono',
});

const SITE_DESCRIPTION =
  'Tools for finding, viewing, and working with Clone Hero charts: find songs you know from Spotify, view drum charts as sheet music, add lyrics to charts, and more — all in your browser.';

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: {
    default: 'Music Charts Tools',
    template: '%s · Music Charts Tools',
  },
  description: SITE_DESCRIPTION,
  // Per-page metadata only sets `title` and `description` and lets Next
  // auto-fill og:title / og:description / twitter:title /
  // twitter:description from those. Setting them here too would block
  // that bubble-up — so root layout only carries fields that genuinely
  // are site-wide (siteName, card type). The og-image is auto-discovered
  // from app/opengraph-image.tsx.
  openGraph: {
    type: 'website',
    siteName: 'Music Charts Tools',
  },
  twitter: {
    card: 'summary_large_image',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body
        className={cn(
          'bg-background flex flex-col h-screen font-sans antialiased',
          fontMono.variable,
        )}>
        <ContextProviders>
          {/* `SiteNav` is passed in, not imported by `SiteHeader`: the
              header has to read the pathname (client) to pick between the
              nav and the compact editor row, and passing the nav as a prop
              keeps the server-rendered nav out of the client bundle. */}
          <SiteHeader siteNav={<SiteNav />} />
          <SiteMain>{children}</SiteMain>
        </ContextProviders>
        <Toaster />
        <WebMCPInit />
        <WebMCPTools />
        <RegionAwareAnalytics gaId="G-LEE7EDJH14" />
      </body>
    </html>
  );
}
