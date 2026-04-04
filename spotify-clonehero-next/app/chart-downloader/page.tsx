import {Suspense} from 'react';
import SupportedBrowserWarning from '../SupportedBrowserWarning';
import ChartDownloader from './ChartDownloader';

export default function Page() {
  return (
    <div className="container mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold text-center mb-2">
        Chart Downloader
      </h1>
      <p className="text-muted-foreground text-center mb-8">
        Download all missing charts from Chorus, stripped to just notes +
        song.ini
      </p>
      <Suspense fallback={<div>Loading...</div>}>
        <SupportedBrowserWarning>
          <ChartDownloader />
        </SupportedBrowserWarning>
      </Suspense>
    </div>
  );
}
