import type {Metadata} from 'next';
import BassEditClient from './BassEditClient';

export const metadata: Metadata = {
  title: 'Edit a bass chart',
  description:
    'Browser-based bass chart editor for Clone Hero — like Moonscraper, no install needed.',
};

export default function Page() {
  return <BassEditClient />;
}
