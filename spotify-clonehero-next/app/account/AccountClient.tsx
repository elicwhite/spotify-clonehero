'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Star, Music, ExternalLink, LogOut, SproutIcon as Spotify, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { unfavoriteSongByHash } from './actions'
import { Icons } from '@/components/icons'

type SavedSong = {
  id: string
  title: string
  composer: string
  difficulty?: string
  genre?: string
}

export default function AccountClient({
  initialSavedSongs,
  spotifyLinked,
}: {
  initialSavedSongs: SavedSong[]
  spotifyLinked: boolean
}) {
  const supabase = createClient()
  const router = useRouter()
  const [favoritedSongs, setFavoritedSongs] = useState<SavedSong[]>(initialSavedSongs)
  const [isSpotifyConnected, setIsSpotifyConnected] = useState<boolean>(spotifyLinked)

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const handleSpotifyConnect = async () => {
    const redirectUrl = `${window.location.origin}/auth/callback?next=${encodeURIComponent('/account')}`
    const { error } = await supabase.auth.linkIdentity({
      // @ts-ignore
      provider: 'spotify',
      options: {
        redirectTo: redirectUrl,
        scopes: 'user-read-email user-library-read playlist-read-private playlist-read-collaborative',
      } as any,
    })
    if (!error) setIsSpotifyConnected(true)
  }

  const toggleFavorite = async (songId: string) => {
    const res = await unfavoriteSongByHash(songId)
    if (res?.ok) {
      setFavoritedSongs(songs => songs.filter(s => s.id !== songId))
    }
  }

  const handleDeleteAccount = () => {
    // placeholder UI action
    alert('Account deletion is not implemented in this demo.')
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">My Account</h1>
            <p className="text-muted-foreground">Manage your sheet music collection and preferences</p>
          </div>
          <Button variant="outline" onClick={handleSignOut} className="flex items-center gap-2 bg-transparent">
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Music className="h-5 w-5 text-primary" />
                  Favorited Songs ({favoritedSongs.length})
                </CardTitle>
                <CardDescription>Your collection of favorite sheet music pieces</CardDescription>
              </CardHeader>
              <CardContent>
                {favoritedSongs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Music className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No favorited songs yet</p>
                    <p className="text-sm">Start exploring sheet music to build your collection!</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {favoritedSongs.map(song => (
                      <div
                        key={song.id}
                        className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex-1">
                          <Link href={`/sheet-music/${song.id}`} className="group flex items-start gap-3">
                            <div className="flex-1">
                              <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                                {song.title}
                              </h3>
                              <p className="text-sm text-muted-foreground mb-2">by {song.composer}</p>
                              <div className="flex gap-2">
                                {song.difficulty ? (
                                  <Badge variant="secondary" className="text-xs">
                                    {song.difficulty}
                                  </Badge>
                                ) : null}
                                {song.genre ? (
                                  <Badge variant="outline" className="text-xs">
                                    {song.genre}
                                  </Badge>
                                ) : null}
                              </div>
                            </div>
                            <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors mt-1" />
                          </Link>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => toggleFavorite(song.id)} className="ml-4 p-2">
                          <Star className={`h-4 w-4 text-muted-foreground`} />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            {isSpotifyConnected && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Icons.spotify className="h-5 w-5 text-green-500" />
                    Link with Spotify
                  </CardTitle>
                  <CardDescription>
                    Connect your Spotify account for more features
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="text-sm text-muted-foreground space-y-2">
                      <ul className="list-disc pl-5 space-y-1">
                        <li>Find songs in your library</li>
                      </ul>
                    </div>
                    <Button onClick={handleSpotifyConnect} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
                      <Icons.spotify className="h-4 w-4 mr-2" />
                      Connect Spotify
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="border-destructive/20">
              <CardHeader>
                <CardTitle className="text-destructive">Danger Zone</CardTitle>
                <CardDescription>Permanently delete your account and all data</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="destructive" onClick={handleDeleteAccount} className="w-full flex items-center gap-2">
                  <Trash2 className="h-4 w-4" />
                  Delete Account
                </Button>
                <p className="text-xs text-muted-foreground mt-2 text-center">This action cannot be undone</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}


