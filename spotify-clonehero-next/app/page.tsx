import Image from 'next/image'
import SongsPicker from './SongsPicker'

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <SongsPicker />
    </main>
  )
}
