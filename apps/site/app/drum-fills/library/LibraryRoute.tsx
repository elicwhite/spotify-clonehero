'use client';

import {useRouter} from 'next/navigation';
import {useDrumFillsChrome} from '../contexts/DrumFillsChromeContext';
import LibraryView from '../components/LibraryView';

/**
 * Library surface (`/drum-fills/library`). Each fill deep-links to its practice
 * route. Re-keyed on scan completion so the grid reflects the latest scan.
 */
export default function LibraryRoute() {
  const router = useRouter();
  const {scanVersion} = useDrumFillsChrome();

  return (
    <div className="flex min-h-0 max-w-screen-xl flex-1 flex-col overflow-hidden">
      <LibraryView
        key={scanVersion}
        onPracticeFill={fillId =>
          router.push(`/drum-fills/practice/${encodeURIComponent(fillId)}`)
        }
      />
    </div>
  );
}
