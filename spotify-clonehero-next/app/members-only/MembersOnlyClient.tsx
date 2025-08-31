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
      </CardContent>
    </Card>
  )
}
