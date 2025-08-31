'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SignOutButton } from './SignOutButton'
import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export function MembersOnlyClient({ spotifyLinked }: { spotifyLinked: boolean }) {
  const supabase = createClient()
  const [linking, setLinking] = useState(false)
  const router = useRouter()
  const [savedSongs, setSavedSongs] = useState<Array<{ name: string; artist: string; charter: string; hash: string }>>([])

  useEffect(() => {
    let ignore = false
    async function loadSaved() {
      const { data: userRes } = await supabase.auth.getUser()
      const uid = userRes?.user?.id
      if (!uid) return

      const { data, error } = await supabase
        .from('user_saved_songs')
        .select('song_hash,enchor_songs(name,artist,charter,hash)')
        .eq('user_id', uid)

      if (error) return
      if (ignore) return

      const rows = (data || []).map((r: any) => {
        const s = r.enchor_songs || {}
        return {
          name: s.name,
          artist: s.artist,
          charter: s.charter,
          hash: s.hash,
        }
      })
      setSavedSongs(rows)
    }
    loadSaved()
    return () => {
      ignore = true
    }
  }, [supabase])

  const handleLinkSpotify = async () => {
    try {
      setLinking(true)
      const redirectUrl = `${window.location.origin}/auth/callback?next=${encodeURIComponent('/members-only')}`;

      const { error } = await supabase.auth.linkIdentity({
        provider: 'spotify' as any,
        options: {
          redirectTo: redirectUrl,
          scopes: 'user-read-email user-library-read playlist-read-private playlist-read-collaborative',
        } as any,
      })
      if (error) {
        // eslint-disable-next-line no-alert
        alert(error.message)
      }
    } finally {
      setLinking(false)
    }
  }

  const handleGoHome = () => {
    router.push('/')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
        <CardDescription>Manage your account</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {spotifyLinked ? null : (
          <Button onClick={handleLinkSpotify} className="w-full" disabled={linking}>
            {linking ? 'Linking Spotify…' : 'Link Spotify'}
          </Button>
        )}
        <SignOutButton />
        <Button
          onClick={handleGoHome}
          variant="outline"
          className="w-full"
        >
          Back to Home
        </Button>
        <div>
          <div className="font-medium mb-2">Saved Songs</div>
          {savedSongs.length === 0 ? (
            <div className="text-sm text-muted-foreground">No saved songs yet.</div>
          ) : (
            <ul className="space-y-1">
              {savedSongs.map(s => (
                <li key={s.hash} className="text-sm">
                  {s.name} <span className="text-muted-foreground">by</span> {s.artist}
                  {s.charter ? (
                    <span className="text-muted-foreground"> • Charted by {s.charter}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
