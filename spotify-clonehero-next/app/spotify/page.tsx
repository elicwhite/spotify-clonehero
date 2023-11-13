import Spotify from './Spotify';

export default function page() {
  return (
    <main className="flex max-h-screen flex-col items-center justify-between p-24">
      <Spotify />
    </main>
  );
}
