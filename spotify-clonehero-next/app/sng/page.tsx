import type {Metadata} from 'next';
import SngLanding from './components/SngLanding';

export const metadata: Metadata = {
  title: 'SNG File Manager',
  description:
    'Create and modify Clone Hero .sng files in your browser. Build a package from a folder or files, inspect an existing .sng, add or remove files, and download as .sng or .zip.',
};

export default function Page() {
  return <SngLanding />;
}
