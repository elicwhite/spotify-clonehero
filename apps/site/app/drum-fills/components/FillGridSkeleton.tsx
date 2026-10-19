/**
 * Placeholder grid shown while the library loads from the local DB (or while a
 * fill's chart loads in the practice view). Pure presentational, no data.
 */
export function FillGridSkeleton({count = 8}: {count?: number}) {
  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      aria-hidden>
      {Array.from({length: count}).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-lg border bg-card p-4">
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          <div className="h-16 animate-pulse rounded bg-muted" />
          <div className="flex gap-1.5">
            <div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
            <div className="h-5 w-12 animate-pulse rounded-full bg-muted" />
            <div className="h-5 w-12 animate-pulse rounded-full bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
