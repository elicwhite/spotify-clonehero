import Image from 'next/image';
import SongsPicker from './SongsPicker';
import SongsDownloader from './SongsDownloader';

const customers = [
  {
    id: '0',
    image: null,
    name: 'Alex Shatov',
    email: 'alexshatov@gmail.com',
    location: '🇺🇸',
    spent: '$2,890.66',
  },
  {
    id: '1',
    image: null,
    name: 'Philip Harbach',
    email: 'philip.h@gmail.com',
    location: '🇩🇪',
    spent: '$2,767.04',
  },
  {
    id: '2',
    image: null,
    name: 'Mirko Fisuk',
    email: 'mirkofisuk@gmail.com',
    location: '🇫🇷',
    spent: '$2,996.00',
  },
  {
    id: '3',
    image: null,
    name: 'Olga Semklo',
    email: 'olga.s@cool.design',
    location: '🇮🇹',
    spent: '$1,220.66',
  },
  {
    id: '4',
    image: null,
    name: 'Burak Long',
    email: 'longburak@gmail.com',
    location: '🇬🇧',
    spent: '$1,890.66',
  },
];

export default function Home() {
  return (
    <main className="flex max-h-screen flex-col items-center justify-between p-24">
      <SongsPicker />
      <SongsDownloader />
    </main>
  );
}
