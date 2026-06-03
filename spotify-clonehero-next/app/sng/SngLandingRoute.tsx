'use client';

import {useRouter} from 'next/navigation';
import {useSng} from './SngContext';
import SngLanding from './components/SngLanding';

export default function SngLandingRoute() {
  const router = useRouter();
  const {reset, loadSng} = useSng();

  return (
    <SngLanding
      onCreate={() => {
        reset();
        router.push('/sng/manage');
      }}
      onPickSng={async file => {
        if (await loadSng(file)) router.push('/sng/manage');
      }}
    />
  );
}
