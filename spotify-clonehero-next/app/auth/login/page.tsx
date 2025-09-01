import {redirect} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import {LoginForm} from './LoginForm';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{next?: string}>;
}) {
  const supabase = await createClient();
  const {data, error} = await supabase.auth.getUser();

  if (error || !data?.user) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center p-6 md:p-10">
        <div className="w-screen max-w-sm md:max-w-md">
          <LoginForm />
        </div>
      </div>
    );
  }

  // User is already authenticated, redirect to next parameter or account page
  const params = await searchParams;
  const nextUrl = params.next || '/account';
  redirect(nextUrl);
}
