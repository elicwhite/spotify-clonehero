import {Button} from '@/components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {Download, Filter, Music} from 'lucide-react';
import Link from 'next/link';

export default function WelcomeCard() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative">
        <div className="container mx-auto px-4 py-4 md:py-8">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-4xl md:text-5xl font-bold text-balance mb-6 text-primary">
              Charts From Your Spotify Library
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground text-pretty mb-8 max-w-3xl mx-auto">
              Connect your Spotify library and instantly find Clone Hero charts
              you know. Filter by instruments, install directly, and rock out to
              your favorite songs.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Link href="/spotify/app">
                <Button
                  size="lg"
                  className="text-lg px-8 py-6 bg-primary hover:bg-primary/90">
                  Get Started
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-14 md:py-20">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <Card className="border-2 hover:border-primary/50 transition-colors">
              <CardHeader className="text-center">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-4">
                  <Music className="h-6 w-6 text-primary" />
                </div>
                <CardTitle>Spotify Integration</CardTitle>
                <CardDescription>
                  Seamlessly scan your Spotify library to find charts for your
                  favorite songs on enchor.us
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-2 hover:border-primary/50 transition-colors">
              <CardHeader className="text-center">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-4">
                  <Download className="h-6 w-6 text-primary" />
                </div>
                <CardTitle>Direct Installation</CardTitle>
                <CardDescription>
                  Install charts directly to your game folder, no copying from
                  Downloads!
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-2 hover:border-primary/50 transition-colors">
              <CardHeader className="text-center">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-4">
                  <Filter className="h-6 w-6 text-primary" />
                </div>
                <CardTitle>Instrument Filtering</CardTitle>
                <CardDescription>
                  Search for charts that support specific instruments like
                  drums, guitar, bass, or a combination
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
}
