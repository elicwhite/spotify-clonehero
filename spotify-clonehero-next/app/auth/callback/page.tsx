'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function AuthCallbackPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // Get the URL parameters to check for OTP verification
        const urlParams = new URLSearchParams(window.location.search)
        const token_hash = urlParams.get('token_hash')
        const type = urlParams.get('type')
        
        if (token_hash && type) {
          // This is an OTP verification - verify the token
          const { error } = await supabase.auth.verifyOtp({
            type: type as any,
            token_hash,
          })
          
          if (error) {
            setError(error.message)
            setLoading(false)
            return
          }
          
          // OTP verified successfully, redirect to members-only
          router.push('/members-only')
        } else {
          // No OTP parameters, try to get existing session
          const { data, error } = await supabase.auth.getSession()
          
          if (error) {
            setError(error.message)
            setLoading(false)
            return
          }

          if (data.session) {
            // Successfully authenticated, redirect to members-only page
            router.push('/members-only')
          } else {
            // If no session, try to get the user directly
            const { data: userData } = await supabase.auth.getUser()
            if (userData.user) {
              router.push('/members-only')
            } else {
              setError('Authentication failed')
              setLoading(false)
            }
          }
        }
      } catch (err) {
        setError('An unexpected error occurred')
        setLoading(false)
      }
    }

    handleAuthCallback()
  }, [supabase.auth, router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
            <p className="mt-4 text-gray-600">Authenticating...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-xl text-red-600">Authentication Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={() => router.push('/auth/login')}
              className="w-full"
            >
              Try Again
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push('/')}
              className="w-full"
            >
              Back to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return null
}
