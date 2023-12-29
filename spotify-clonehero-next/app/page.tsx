import {ReactNode} from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {AiOutlineDoubleRight} from 'react-icons/ai';

const SupportedBrowserWarning = dynamic(
  () => import('./SupportedBrowserWarning'),
  {
    ssr: false,
  },
);

function Card({children}: {children: ReactNode}) {
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
    <div className="max-w-4xl">
      <Card>
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
      </Card>
      <Card>
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
      </Card>

      <Card>
        <ToolTitle>Spotify Library</ToolTitle>
        <p className="my-4">
          Find charts on Chorus that match songs you have saved in your Spotify
          playlists
        </p>
      </Card>

      <Card>
        <ToolTitle>Spotify History (advanced!)</ToolTitle>
        <p className="my-4">
          If you&apos;ve downloaded your Complete Listening History from your
          Spotify Account settings, this will find charts to songs you&apos;ve
          ever listened to.
        </p>
      </Card>

      <Card>
        <ToolTitle>Chart Error Checker</ToolTitle>
        <p className="my-4">
          Primarily for charters. Check your charts for quality issues that will
          get flagged by the Chorus bot before submitting.
        </p>
      </Card>
    </div>
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
