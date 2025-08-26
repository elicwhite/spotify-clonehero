import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MembersOnlyClient } from './MembersOnlyClient'

export default async function MembersOnlyPage() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  
  if (error || !data?.user) {
    redirect('/auth/login')
  }

  const user = data.user
  
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Welcome to the Members Area
          </h1>
          <p className="text-lg text-gray-600">
            This is a protected page that only authenticated users can access.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Your Profile</CardTitle>
              <CardDescription>Your authentication details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Email</label>
                <p className="text-sm text-gray-900">{user.email}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">User ID</label>
                <p className="text-sm text-gray-900 font-mono">{user.id}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Last Sign In</label>
                <p className="text-sm text-gray-900">
                  {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : 'Never'}
                </p>
              </div>
            </CardContent>
          </Card>

          <MembersOnlyClient />
        </div>

        <div className="mt-8">
          <Card>
            <CardHeader>
              <CardTitle>Exclusive Content</CardTitle>
              <CardDescription>This is where your members-only content would go</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">
                Congratulations! You&apos;ve successfully accessed the protected members area. 
                This page demonstrates that Supabase authentication is working correctly 
                with magic link login.
              </p>
              <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
                <p className="text-sm text-blue-800">
                  <strong>Note:</strong> This is a demo page. In a real application, 
                  you would put your exclusive content, premium features, or private 
                  information here.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
