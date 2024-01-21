import dynamic from 'next/dynamic';

/*
Pretty much all of the code that powers this page
is copied from liquid's work!
*/

const Preview = dynamic(() => import('./Preview'), {
  ssr: false,
});

export default function Page() {
  return <Preview />;
}
