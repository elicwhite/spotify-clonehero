import Link from 'next/link';
import {
  CardTitle,
  CardDescription,
  CardHeader,
  CardContent,
  Card,
} from '@/components/ui/card';
import {buttonVariants} from '@/components/ui/button';
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
            <CardTitle>
              Find Music
              <Badge className="ml-2 align-middle" variant="default">
                New
              </Badge>
            </CardTitle>
            <CardDescription>
              Find charts on Chorus for the music you already listen to. Match
              your Spotify or Apple Music library and your listening history,
              and get recommendations from the artists you play most.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 py-4">
            <Link
              href="/find-music"
              className={buttonVariants({variant: 'default'})}>
              Go to Tool
            </Link>
          </CardContent>
        </Card>
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
            <CardTitle>
              Add Lyrics to a Chart
              <Badge className="ml-2 align-middle" variant="default">
                New
              </Badge>
            </CardTitle>
            <CardDescription>
              Paste your lyrics and they&apos;re automatically synced to any
              Clone Hero chart, syllable-by-syllable. Runs entirely in your
              browser.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 py-4">
            <Link
              href="add-lyrics"
              className={buttonVariants({variant: 'default'})}>
              Go to Tool
            </Link>
          </CardContent>
        </Card>
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <CardTitle>
              SNG File Manager
              <Badge className="ml-2 align-middle" variant="default">
                New
              </Badge>
            </CardTitle>
            <CardDescription>
              Create, modify, and convert Clone Hero <code>.sng</code> files.
              Build a package from a folder or files, inspect an existing one,
              add or remove files, and convert to <code>.zip</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 py-4">
            <Link href="sng" className={buttonVariants({variant: 'default'})}>
              Go to Tool
            </Link>
          </CardContent>
        </Card>
      </section>
      <footer className="mt-10 border-t border-border/60 pt-4 text-xs text-muted-foreground flex justify-end">
        <Link href="/privacy" className="hover:underline">
          Privacy
        </Link>
      </footer>
    </main>
  );
}
