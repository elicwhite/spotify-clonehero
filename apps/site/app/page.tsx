import type {Metadata} from 'next';

import {PlayerLanding} from './landing/PlayerLanding';

// Title stays the root layout's default ('Music Charts Tools') rather than
// repeating the hero — the home page is the one page whose name is the site's.
export const metadata: Metadata = {
  description:
    'Find Clone Hero charts for the music in your Spotify or Apple Music library, and view drum charts as sheet music. Everything runs in your browser.',
};

export default function Page() {
  return <PlayerLanding />;
}
