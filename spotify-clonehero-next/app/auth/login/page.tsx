import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LoginForm } from './LoginForm'

export default async function LoginPage() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  
  if (error || !data?.user) {
    // User is not authenticated, show login form
    return <LoginForm />
  }

  // User is already authenticated, redirect to members-only
  redirect('/members-only')
}
