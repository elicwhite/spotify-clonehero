import type {Metadata} from 'next';

import {WhyPage} from './WhyPage';

export const metadata: Metadata = {
  title: 'Why I build these tools',
  description:
    'I want more high-quality charts for the songs people want to play, without moving the bar for what counts as good. What I am building toward, and what I hold to while building it.',
};

export default function Page() {
  return <WhyPage />;
}
