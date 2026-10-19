import type {Metadata} from 'next';
import ChartScanDebugClient from './ChartScanDebugClient';

export const metadata: Metadata = {
  title: 'Songs Folder Diagnostic',
  description:
    'Check what your browser reports about your Clone Hero Songs folder, and share the result to help diagnose a scan that finds no charts.',
  robots: {index: false, follow: false},
};

export default function Page() {
  return <ChartScanDebugClient />;
}
