'use client';

import dynamic from 'next/dynamic';

const CompareChartsToLocal = dynamic(() => import('../CompareChartsToLocal'), {
  ssr: false,
});

import {testSameCharter} from '@/lib/chartSelection/comparisonTests';

const RANKING_GROUPS = [[testSameCharter]];

/* TODO:
- Show progress indicator while downloading db from Enchor
*/
export default function SongsPicker() {
  return (
    <>
      <p className="mb-4 text-center">
        This tool checks your installed charts for updates;
        <br />
        newer versions of the chart from the same charter.
        <br />
        This tool is currently in beta, it is recommended that you
        <br />
        backup your Songs folder before using this tool.
      </p>
      <CompareChartsToLocal rankingGroups={RANKING_GROUPS} exact={true} />
    </>
  );
}
