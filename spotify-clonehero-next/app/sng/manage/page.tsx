import type {Metadata} from 'next';
import SngManage from './SngManage';

export const metadata: Metadata = {
  title: 'Edit SNG package',
  description:
    'Add, remove, and preview the files in a Clone Hero .sng package, then download it as .sng or .zip.',
};

export default function Page() {
  return <SngManage />;
}
