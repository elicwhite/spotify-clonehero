import type {Metadata} from 'next';
import GuitarDifficultiesClient from './GuitarDifficultiesClient';

// Per-page openGraph/twitter blocks would replace the root-layout
// blocks entirely (Next merges metadata field-by-field at the top
// level only). Setting just title + description here and letting Next
// auto-fill og:title / og:description / twitter:title / twitter:description
// keeps siteName, card type, and the auto-discovered og-image from the
// root layout intact.
export const metadata: Metadata = {
  title: 'Generate guitar Hard, Medium, and Easy from Expert',
  description:
    'Drop a chart with an Expert guitar track and Hard, Medium, and Easy are ' +
    'generated in your browser. The tiers open in the chart editor for review.',
};

export default function Page() {
  return <GuitarDifficultiesClient />;
}
