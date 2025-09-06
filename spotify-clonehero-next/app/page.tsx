import {ReactNode} from 'react';
import Link from 'next/link';
import {
  CardTitle,
  CardDescription,
  CardHeader,
  CardContent,
  Card,
  CardFooter,
} from '@/components/ui/card';
import {Button, buttonVariants} from '@/components/ui/button';
import {RxExternalLink} from 'react-icons/rx';
import SupportedBrowserWarning from './SupportedBrowserWarning';
import {Badge} from '@/components/ui/badge';

export default function Home() {
  return (
    <main className="max-w-4xl p-8">
      <section className="mb-10">
        {/* <h1 className="text-4xl font-bold">Welcome to Our Tools Collection</h1> */}
        <p className="text-lg mt-2">
          This site provides a collection of tools to help you find charts to
          songs you know but might not find in Chorus&apos;s 10s of thousands of
          charts.
        </p>
        <p className="text-lg mt-2">
          No downloads required! These tools don&apos;t require any downloads or
          custom applications on your computer. Manage your Songs directory
          directly from your browser.
        </p>

        <SupportedBrowserWarning />
      </section>
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-8">
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <CardTitle>Drum Sheet Music Viewer</CardTitle>
            <CardDescription>
              View drum charts as sheet music! Automatically synced click tracks
              and individual audio track control lets you practice and play
              along.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 py-4">
            <Link
              href="sheet-music"
              className={buttonVariants({variant: 'default'})}>
              Go to Tool
            </Link>
          </CardContent>
        </Card>
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <CardTitle>Spotify History (advanced!)</CardTitle>
            <CardDescription>
              If you&apos;ve downloaded your{' '}
              <a
                href="https://www.spotify.com/us/account/privacy/"
                className="text-accent-foreground">
                Extended Streaming History <RxExternalLink className="inline" />
              </a>{' '}
              from your Spotify Account settings, this will find charts to songs
              you&apos;ve ever listened to.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 py-4">
            <Link
              href="spotifyhistory"
              className={buttonVariants({variant: 'default'})}>
              Go to Tool
            </Link>
          </CardContent>
        </Card>
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <CardTitle>
              Spotify Library Scanner
              <Badge className="ml-2 align-middle" variant="default">
                Beta
              </Badge>
            </CardTitle>
            <CardDescription>
              Find charts on Chorus that match songs you have saved in your
              Spotify playlists.
            </CardDescription>
          </CardHeader>
          <CardFooter className="grid gap-4 py-4">
            <Link
              href="/spotify"
              className={buttonVariants({variant: 'default'})}>
              Try the Beta
            </Link>
          </CardFooter>
        </Card>
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <CardTitle>Updater</CardTitle>
            <CardDescription>
              Check Chorus for newer versions of your installed charts.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 py-4">
            <Link
              href="/updates"
              className={buttonVariants({variant: 'default'})}>
              Go to Tool
            </Link>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
