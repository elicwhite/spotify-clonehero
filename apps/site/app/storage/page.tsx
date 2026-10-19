import type {Metadata} from 'next';

import {StoragePage} from './StoragePage';

export const metadata: Metadata = {
  title: 'Storage',
  description:
    'What this browser is holding for Music Charts Tools, whether it has promised to keep it, and what can be freed without losing any work.',
};

export default function Page() {
  return <StoragePage />;
}
