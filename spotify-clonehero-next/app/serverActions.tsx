'use server';

export async function searchForChart(
  artist: string,
  song: string,
): Promise<string> {
  const uriComponent = encodeURIComponent(`name="${song}" artist="${artist}"`);

  const response = await fetch(
    `https://chorus.fightthe.pw/api/search?query=${uriComponent}`,
  );
  const json = await response.json();
  return JSON.stringify(json.songs);
}
