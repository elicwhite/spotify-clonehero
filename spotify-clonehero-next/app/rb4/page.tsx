import dynamic from 'next/dynamic';

const RockBand4 = dynamic(() => import('./RockBand4'), {
  ssr: false,
});

export default function Page() {
  return <RockBand4 />;
}
