import dynamic from 'next/dynamic';

const Checker = dynamic(() => import('./Checker'), {
  ssr: false,
});

export default function Page() {
  return <Checker />;
}
