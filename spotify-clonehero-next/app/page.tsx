import {ReactNode} from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {AiOutlineDoubleRight} from 'react-icons/ai';
import {
  CardTitle,
  CardDescription,
  CardHeader,
  CardContent,
  Card,
  CardFooter,
} from '@/components/ui/card';
import {Button} from '@/components/ui/button';

const SupportedBrowserWarning = dynamic(
  () => import('./SupportedBrowserWarning'),
  {
    ssr: false,
  },
);

function LCard({children}: {children: ReactNode}) {
  return (
    <div className="bg-white hover:bg-gray-50 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg ring-1 ring-slate-900/5 shadow-xl p-4 sm:p-8 py-2 sm:py-4 my-2 sm:my-4">
      {children}
    </div>
  );
}

function ToolTitle({children}: {children: ReactNode}) {
  return <p className="text-xl">{children}</p>;
}

export default function Home() {
  return (
    <>
      <Intro />
      <div className="max-w-4xl">
        <LCard>
          <p className="my-4">
            This site primarily provides a collection of tools to help you find
            charts to songs you know but might not find in Chorus&apos;s 10s of
            thousands of charts.
          </p>

          <p className="my-4">
            The tools on this website don&apos;t require any downloads or custom
            applications on your computer. Manage your Songs directory directly
            from your browser!
          </p>

          <SupportedBrowserWarning />
        </LCard>
        <LCard>
          <div className="flex flex-1">
            <div>
              <ToolTitle>Updates</ToolTitle>
              <p className="my-4">
                Check Chorus for newer/better charts than you have installed.
                Looks for newer charts that charter has published, and higher
                quality charts (more instruments, difficulties, and more)
              </p>
            </div>
            <div className="w-16 ml-8 flex justify-center items-center">
              <Link href="/" className="">
                <AiOutlineDoubleRight className="text-4xl" />
              </Link>
            </div>
          </div>
        </LCard>

        <LCard>
          <ToolTitle>Spotify Library</ToolTitle>
          <p className="my-4">
            Find charts on Chorus that match songs you have saved in your
            Spotify playlists
          </p>
        </LCard>

        <LCard>
          <ToolTitle>Spotify History (advanced!)</ToolTitle>
          <p className="my-4">
            If you&apos;ve downloaded your Complete Listening History from your
            Spotify Account settings, this will find charts to songs you&apos;ve
            ever listened to.
          </p>
        </LCard>

        <LCard>
          <ToolTitle>Chart Error Checker</ToolTitle>
          <p className="my-4">
            Primarily for charters. Check your charts for quality issues that
            will get flagged by the Chorus bot before submitting.
          </p>
        </LCard>
      </div>
    </>
  );
}

function Intro() {
  return (
    <main className="p-8">
      <section className="mb-10">
        <h1 className="text-4xl font-bold">Welcome to Our Tools Collection</h1>
        <p className="text-lg text-gray-600 mt-2">
          This site provides a collection of tools to help you find charts to
          songs you know but might not find in Chorus&apos;s 10s of thousands of
          charts.
        </p>
        <p className="text-lg text-gray-600 mt-2">
          The tools on this website don&apos;t require any downloads or custom
          applications on your computer. Manage your Songs directory directly
          from your browser.
        </p>

        <SupportedBrowserWarning />
      </section>
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle>Updater</CardTitle>
            <CardDescription>
              Check Chorus for newer/better charts than you have installed.
              Looks for newer charts that the charter has published, and higher
              quality charts (more instruments, difficulties, and more).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 py-4">
            <Button size="sm">
              <Link href="#">Go to Tool 1</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Spotify Library Scanner</CardTitle>
            <CardDescription>
              Find charts on Chorus that match songs you have saved in your
              Spotify playlists
            </CardDescription>
          </CardHeader>
          <CardFooter className="grid gap-4 py-4">
            <Button size="sm">
              <Link href="#">Go to Tool 2</Link>
            </Button>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Spotify History (advanced!)</CardTitle>
            <CardDescription>
              If you&apos;ve downloaded your Complete Listening History from
              your Spotify Account settings, this will find charts to songs
              you&apos;ve ever listened to.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 py-4">
            <Button size="sm">
              <Link href="#">Go to Tool 3</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Chart Error Checker</CardTitle>
            <CardDescription>
              Primarily for charters. Check your charts for quality issues that
              will get flagged by the Chorus bot before submitting.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 py-4">
            <Button size="sm">
              <Link href="#">Go to Tool 3</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

/*

# Overall Intro
This site primarily provides a collection of tools to help
you find charts to songs you know but might not find in
Chorus's 10s of thousands of charts.

The tools on this website don't require any downloads or custom
applications on your computer. Manage your Songs directory directly
from your browser!

Note: This website will not work on your browser. It requires some APIs that
currently only exist in Chrome based browsers.

# Tools:
## Updates
Check Chorus for newer/better charts than you have installed.
Looks for newer charts that charter has published, and higher quality charts (more instruments, difficulties, and more)

## Spotify Library
Find charts on Chorus that match songs you have saved in your Spotify playlists

## Spotify History (advanced!)
If you've downloaded your Complete Listening History from your Spotify Account settings,
this will find charts to songs you've ever listened to.

## Chart Error Checker
Primarily for charters. Check your charts for quality issues that will get flagged
by the Chorus bot before submitting.
*/
