import Image from 'next/image';
import SongsPicker from './SongsPicker';
import SongsDownloader from './SongsDownloader';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <SongsPicker />
      <SongsDownloader />
    </main>
  );
}
