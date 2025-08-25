'use client';

import {useSession} from 'next-auth/react';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

// Import the individual tab components
import AllSongsTab from './AllSongsTab';
import PlaylistSelectorTab from './PlaylistSelectorTab';

export default function Spotify() {
  const session = useSession();

  if (session.status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Card>
          <CardHeader>
            <CardTitle>Loading...</CardTitle>
            <CardDescription>
              Checking your authentication status...
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (session.status !== 'authenticated') {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Card>
          <CardHeader>
            <CardTitle>Authentication Required</CardTitle>
            <CardDescription>
              Please sign in with your Spotify account using the button in the header to access these tools.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6">
      <Tabs defaultValue="playlists" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="playlists">Playlist Selector</TabsTrigger>
          <TabsTrigger value="all-songs">All Songs Search</TabsTrigger>
        </TabsList>
        
        <TabsContent value="all-songs" className="mt-6">
          <AllSongsTab />
        </TabsContent>
        
        <TabsContent value="playlists" className="mt-6">
          <PlaylistSelectorTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

