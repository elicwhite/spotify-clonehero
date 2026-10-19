import type {Metadata} from 'next';
import AddLyricsClient from './AddLyricsClient';

// Per-page openGraph/twitter blocks would replace the root-layout
// blocks entirely (Next merges metadata field-by-field at the top
// level only). Setting just title + description here and letting Next
// auto-fill og:title / og:description / twitter:title / twitter:description
// keeps siteName, card type, and the auto-discovered og-image from the
// root layout intact.
export const metadata: Metadata = {
  title: 'Add synced lyrics to a chart',
  description:
    'Paste lyrics and each syllable is aligned to the vocal of any Clone Hero chart, in your browser. The result opens in the chart editor for review.',
};

export default function Page() {
  return <AddLyricsClient />;
}
