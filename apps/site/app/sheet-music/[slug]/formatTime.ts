export function formatSeconds(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins)}:${String(secs).padStart(2, '0')}`;
}

export function formatTimeMs(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return formatSeconds(seconds);
}
