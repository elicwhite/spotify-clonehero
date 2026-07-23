import type {Metadata} from 'next';
import DifficultiesClient from './DifficultiesClient';

export const metadata: Metadata = {
  title: 'Drum Difficulty Comparison',
  description:
    'Upload a pro-drums chart and compare Hard / Medium / Easy reductions from ' +
    'HOPCAT and Onyx side by side against one shared audio track.',
};

export default function Page() {
  return <DifficultiesClient />;
}
