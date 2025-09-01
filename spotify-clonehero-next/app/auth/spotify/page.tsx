import {redirect} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import {LoginForm} from '../login/LoginForm';

export default async function SpotifyLoginPage({
  searchParams,
}: {
  searchParams: Promise<{next?: string}>;
}) {
  const supabase = await createClient();
  const {data, error} = await supabase.auth.getUser();

  if (!error && data?.user) {
    const params = await searchParams;
    redirect(params.next || '/spotify');
  }

  // Render a Spotify-only login form by reusing LoginForm, but hide email/discord
  return (
    <div className="flex min-h-svh flex-col items-center justify-center p-6 md:p-10">
      <div className="w-screen max-w-sm md:max-w-md">
        <LoginForm spotifyOnly={true} />
      </div>
    </div>
  );
}
