'use client';

import {Button} from '@/components/ui/button';
import {useRouter} from 'next/navigation';
import {createClient} from '@/lib/supabase/client';

export function SignOutButton() {
  const router = useRouter();
  const supabase = createClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  return (
    <Button onClick={handleSignOut} variant="destructive" className="w-full">
      Sign Out
    </Button>
  );
}
