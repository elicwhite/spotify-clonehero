export default function SongHeader({
  name,
  artist,
  charter,
  actions,
}: {
  name: string;
  artist: string;
  charter: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-2 md:mb-4">
      <h1 className="text-3xl md:text-3xl font-bold">
        {name} <span className="text-muted-foreground">by</span> {artist}
        <div className="text-sm text-gray-600 dark:text-gray-400 font-normal">
          Charted by {charter}
        </div>
      </h1>
      {actions}
    </div>
  );
}
