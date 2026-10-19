'use server';

import {createClient} from '@/lib/supabase/server';
import {searchAdvanced} from '@/lib/search-encore';
import {SupabaseClient} from '@supabase/supabase-js';
import {Database} from '@/@types/database.types';

async function ensureSongExists(
  supabase: SupabaseClient<Database>,
  hash: string,
) {
  const {data: existing, error: selErr} = await supabase
    .from('enchor_songs')
    .select('hash')
    .eq('hash', hash)
    .maybeSingle();

  if (selErr) return {ok: false, error: selErr.message};
  if (existing) return {ok: true};

  try {
    const encore = await searchAdvanced({hash});
    const track = encore.data?.[0];
    if (!track) return {ok: false, error: 'Song not found on Encore'};

    const {error: upErr} = await supabase.from('enchor_songs').upsert(
      {
        hash: track.md5,
        name: track.name,
        artist: track.artist,
        charter: track.charter,
      },
      {onConflict: 'hash'},
    );
    if (upErr) return {ok: false, error: upErr.message};
    return {ok: true};
  } catch (e: any) {
    return {ok: false, error: e?.message ?? 'Failed to fetch song'};
  }
}

export async function saveSongByHash(
  hash: string,
  difficulty: string = 'expert',
) {
  const supabase = await createClient();

  const {data: userRes} = await supabase.auth.getUser();
  const user = userRes?.user;
  if (!user) {
    return {ok: false, error: 'Unauthorized'};
  }

  // Ensure song exists
  const ensured = await ensureSongExists(supabase, hash);
  if (!ensured.ok) return ensured;

  const {error: relErr} = await supabase.from('user_saved_songs').upsert(
    {
      user_id: user.id,
      song_hash: hash,
      difficulty,
    },
    {onConflict: 'user_id,song_hash'},
  );

  if (relErr) return {ok: false, error: relErr.message};
  return {ok: true};
}

export async function savePracticeSection(
  hash: string,
  startMs: number,
  endMs: number,
) {
  const supabase = await createClient();

  const {data: userRes} = await supabase.auth.getUser();
  const user = userRes?.user;
  if (!user) {
    return {ok: false, error: 'Unauthorized'};
  }

  // Ensure song exists for FK
  const ensured = await ensureSongExists(supabase, hash);
  if (!ensured.ok) return ensured;

  // Ensure the song is favorited for this user as well
  const {error: favErr} = await supabase.from('user_saved_songs').upsert(
    {
      user_id: user.id,
      song_hash: hash,
      difficulty: 'expert',
    },
    {onConflict: 'user_id,song_hash'},
  );
  if (favErr) return {ok: false, error: favErr.message};

  const {error} = await supabase.from('user_saved_song_spans').insert({
    user_id: user.id,
    song_hash: hash,
    start_ms: startMs,
    end_ms: endMs,
  });
  if (error) return {ok: false, error: error.message};
  return {ok: true};
}

export async function getPracticeSections(hash: string) {
  const supabase = await createClient();
  const {data: userRes} = await supabase.auth.getUser();
  const user = userRes?.user;
  if (!user) {
    return {ok: false, sections: [], error: 'Unauthorized'};
  }

  const {data, error} = await supabase
    .from('user_saved_song_spans')
    .select('id,start_ms,end_ms')
    .eq('user_id', user.id)
    .eq('song_hash', hash)
    .order('start_ms', {ascending: true});

  if (error) return {ok: false, sections: [], error: error.message};
  return {ok: true, sections: data ?? []};
}

export async function deletePracticeSection(id: string) {
  const supabase = await createClient();
  const {data: userRes} = await supabase.auth.getUser();
  const user = userRes?.user;
  if (!user) {
    return {ok: false, error: 'Unauthorized'};
  }

  const {error} = await supabase
    .from('user_saved_song_spans')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return {ok: false, error: error.message};
  return {ok: true};
}
