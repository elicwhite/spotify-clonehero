import DrumTranscriptionClient from './DrumTranscriptionClient';
import type {Metadata} from 'next';

export const metadata: Metadata = {
  title: 'Drum Transcription',
  description:
    'Turn a song into a draft drum chart, then review and edit it in your browser.',
};

export default function Page() {
  return <DrumTranscriptionClient />;
}
