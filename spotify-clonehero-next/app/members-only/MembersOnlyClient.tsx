'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SignOutButton } from './SignOutButton'

export function MembersOnlyClient() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
        <CardDescription>Manage your account</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
