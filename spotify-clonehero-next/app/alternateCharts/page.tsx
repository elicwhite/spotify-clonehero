'use client';

import dynamic from 'next/dynamic';

const CompareChartsToLocal = dynamic(() => import('../CompareChartsToLocal'), {
  ssr: false,
});

import {
  testPreferDrums,
  testPreferGuitar,
  testPreferHarmonix,
  testPreferHigherDiffSum,
  testPreferOfficialTracks,
  testSameCharter,
} from '@/lib/chartSelection/comparisonTests';

const RANKING_GROUPS = [
  [
    testSameCharter,
    testPreferHarmonix,
    testPreferOfficialTracks,
    testPreferDrums,
  ],
  [testPreferGuitar],
  [testPreferHigherDiffSum],
];

/* TODO:
- Show progress indicator while downloading db from Enchor
- Show all matching charts
*/
export default function SongsPicker() {
  return (
    <>
      <p className="mb-4 text-center">
        This tool checks your installed charts for updates,
        <br />
        as well as better charts for those songs.
        <br />
        This tool is currently in beta, it is recommended that you
        <br />
        backup your Songs folder before using this tool.
      </p>
      <CompareChartsToLocal rankingGroups={RANKING_GROUPS} exact={false} />
    </>
  );
}
