'use server';

import {createClient} from '@/lib/supabase/server';

export async function unfavoriteSongByHash(hash: string) {
  try {
    const supabase = await createClient();
    const {data: userRes} = await supabase.auth.getUser();
    const uid = userRes?.user?.id;
    if (!uid) return {ok: false, error: 'Unauthorized'};

    const {error} = await supabase
      .from('user_saved_songs')
      .delete()
      .match({user_id: uid, song_hash: hash});

    if (error) return {ok: false, error: error.message};
    return {ok: true};
  } catch (e: any) {
    return {ok: false, error: e?.message ?? 'Unexpected error'};
  }
}
