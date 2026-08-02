import type {Metadata} from 'next';
import ChartEditorClient from './ChartEditorClient';

export const metadata: Metadata = {
  title: 'Chart editor',
  description:
    'Browser-based Clone Hero chart editor for guitar, bass, and drums.',
};

export default function Page() {
  return <ChartEditorClient />;
}
