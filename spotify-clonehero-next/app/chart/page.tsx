import type {Metadata} from 'next';

import {ChartPage} from './ChartPage';

export const metadata: Metadata = {
  title: 'Tool-assisted charting, one step at a time',
  description:
    'The Clone Hero charting tools, in the order a chart moves through them: tempo map, drum notes, difficulties, lyrics, and packaging. Every tool produces a draft you review in the chart editor.',
};

export default function Page() {
  return <ChartPage />;
}
