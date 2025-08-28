'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SignOutButton } from './SignOutButton'
import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'

export function MembersOnlyClient() {
  const supabase = createClient()
  const [linking, setLinking] = useState(false)

  const handleLinkSpotify = async () => {
    try {
      setLinking(true)
      const { error } = await supabase.auth.linkIdentity({
        provider: 'spotify' as any,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
        <CardDescription>Manage your account</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={handleLinkSpotify} className="w-full" disabled={linking}>
          {linking ? 'Linking Spotify…' : 'Link Spotify Account'}
        </Button>
        <SignOutButton />
        <Button
          onClick={() => window.location.href = '/'}
          variant="outline"
          className="w-full"
        >
          Back to Home
        </Button>
      </CardContent>
    </Card>
  )
}
