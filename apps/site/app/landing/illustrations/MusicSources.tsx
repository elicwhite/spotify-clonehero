import {FolderOpen} from 'lucide-react';
import type {ReactNode} from 'react';

import AppleMusicIcon from '@/components/AppleMusicIcon';
import SpotifyIcon from '@/components/SpotifyIcon';

/**
 * What Find Music reads: the two connected services and the local Songs
 * folder, each with what it contributes.
 *
 * The service marks are the official artwork, drawn to their owners' rules
 * rather than sized to fit a layout:
 *
 * - `SpotifyIcon` holds Spotify's own rules. The row owns the clear space
 *   Spotify asks for: its padding and gap are both 16px, half the 32px mark.
 *   The mark sits directly on `bg-card` — near-black in dark, white in light —
 *   which is where the green icon is allowed to go.
 * - The Apple Music tile is the shipped artwork at the same 32px, unmodified.
 *
 * Both are `aria-hidden`; the name beside each mark is the accessible name.
 */
function Source({
  mark,
  name,
  detail,
}: {
  mark: ReactNode;
  name: string;
  detail: string;
}) {
  return (
    <li className="flex items-center gap-4 rounded-lg border border-border bg-card p-4">
      {mark}
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">
          {name}
        </span>
        <span className="block text-xs leading-5 text-muted-foreground">
          {detail}
        </span>
      </span>
    </li>
  );
}

export function MusicSources() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
      <Source
        mark={<SpotifyIcon />}
        name="Spotify"
        detail="Library and listening history"
      />
      <Source
        mark={<AppleMusicIcon className="h-8 w-8 rounded-[7px]" />}
        name="Apple Music"
        detail="Saved songs"
      />
      <Source
        mark={
          <FolderOpen
            className="h-8 w-8 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        }
        name="Songs folder"
        detail="Where charts install"
      />
    </ul>
  );
}
