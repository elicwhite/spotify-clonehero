'use client';

import {useState} from 'react';
import {
  getLocalDb,
  checkLocalDbHealth,
  getLocalDbStats,
} from '@/lib/local-db/client';
import {
  analyzeDataConsistency,
  deleteOrphanedTracks,
} from '@/lib/local-db/spotify';

export default function TestSQLocalPage() {
  const [status, setStatus] = useState<
    'idle' | 'initializing' | 'ready' | 'error'
  >('idle');
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<boolean | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [consistency, setConsistency] = useState<any>(null);
  const [cleaning, setCleaning] = useState<boolean>(false);
  const [newItem, setNewItem] = useState('');

  const initializeDatabase = async () => {
    setStatus('initializing');
    setError(null);

    try {
      setStatus('ready');

      // Check health
      const isHealthy = await checkLocalDbHealth();
      setHealth(isHealthy);

      // Get stats
      const dbStats = await getLocalDbStats();
      setStats(dbStats);

      // Analyze data consistency
      const consistencyData = await analyzeDataConsistency();
      setConsistency(consistencyData);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Database initialization failed:', err);
    }
  };

  const cleanOrphanedTracks = async () => {
    setCleaning(true);
    setError(null);

    try {
      await deleteOrphanedTracks();

      // Re-analyze data consistency after cleanup
      const consistencyData = await analyzeDataConsistency();
      setConsistency(consistencyData);

      // Refresh stats
      const dbStats = await getLocalDbStats();
      setStats(dbStats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Failed to clean orphaned tracks:', err);
    } finally {
      setCleaning(false);
    }
  };

  // Demo inputs kept for layout; not used with Spotify-only schema

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">SQLocal Test Page</h1>

      <div className="space-y-6">
        {/* Database Status */}
        <div className="bg-gray-100 p-4 rounded-lg">
          <h2 className="text-xl font-semibold mb-2">Database Status</h2>
          <p>
            Status:{' '}
            <span
              className={`font-mono ${status === 'ready' ? 'text-green-600' : status === 'error' ? 'text-red-600' : 'text-yellow-600'}`}>
              {status}
            </span>
          </p>
          {error && <p className="text-red-600 mt-2">Error: {error}</p>}
          {health !== null && (
            <p>
              Health Check:{' '}
              <span className={health ? 'text-green-600' : 'text-red-600'}>
                {health ? 'PASS' : 'FAIL'}
              </span>
            </p>
          )}
          {stats && (
            <p>
              Stats: <span className="font-mono">{JSON.stringify(stats)}</span>
            </p>
          )}
        </div>

        {/* Initialize Button */}
        {status === 'idle' && (
          <button
            onClick={initializeDatabase}
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded">
            Initialize Database
          </button>
        )}

        {/* Ready state content */}
        {status === 'ready' && (
          <div className="space-y-6">
            <div className="bg-white border rounded-lg p-4">
              <h2 className="text-xl font-semibold mb-4">Local DB Ready</h2>
              <p className="text-gray-600">
                Migrations have been applied and the database is ready.
              </p>
            </div>

            {/* Data Consistency Analysis */}
            {consistency && (
              <div className="bg-white border rounded-lg p-4">
                <h2 className="text-xl font-semibold mb-4">
                  Data Consistency Analysis
                </h2>

                {/* Summary Stats */}
                <div className="mb-4">
                  <h3 className="text-lg font-medium mb-2">Summary</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="font-medium">Total Tracks:</span>{' '}
                      {consistency.summary.totalTracks.toLocaleString()}
                    </div>
                    <div>
                      <span className="font-medium">
                        Total Playlist Tracks:
                      </span>{' '}
                      {consistency.summary.totalPlaylistTracks.toLocaleString()}
                    </div>
                    <div>
                      <span className="font-medium">
                        Unique Playlist Tracks:
                      </span>{' '}
                      {consistency.summary.uniquePlaylistTracks.toLocaleString()}
                    </div>
                    <div>
                      <span className="font-medium">Total Playlists:</span>{' '}
                      {consistency.summary.totalPlaylists.toLocaleString()}
                    </div>
                    <div>
                      <span className="font-medium">Avg Tracks/Playlist:</span>{' '}
                      {consistency.summary.avgTracksPerPlaylist}
                    </div>
                    <div>
                      <span className="font-medium">Duplicate Ratio:</span>{' '}
                      {(consistency.summary.duplicateRatio * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>

                {/* Analysis Results */}
                <div className="mb-4">
                  <h3 className="text-lg font-medium mb-2">Analysis</h3>
                  <div className="space-y-2">
                    <div
                      className={`p-2 rounded ${consistency.analysis.isConsistent ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      <span className="font-medium">Data Consistency:</span>{' '}
                      {consistency.analysis.isConsistent
                        ? '✅ CONSISTENT'
                        : '❌ INCONSISTENT'}
                    </div>
                    <div className="p-2 bg-gray-100 rounded">
                      <span className="font-medium">
                        Expected Difference (duplicates):
                      </span>{' '}
                      {consistency.analysis.expectedDifference.toLocaleString()}
                    </div>
                    <div className="p-2 bg-gray-100 rounded">
                      <span className="font-medium">Actual Difference:</span>{' '}
                      {consistency.analysis.actualDifference.toLocaleString()}
                    </div>
                    <div
                      className={`p-2 rounded ${consistency.analysis.isDifferenceExpected ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                      <span className="font-medium">Difference Analysis:</span>{' '}
                      {consistency.analysis.isDifferenceExpected
                        ? '✅ Expected'
                        : '⚠️ Unexpected'}
                    </div>
                  </div>
                </div>

                {/* Issues */}
                {(consistency.issues.orphanedTracks.count > 0 ||
                  consistency.issues.unreferencedTracks.count > 0 ||
                  consistency.issues.trulyOrphanedTracks.count > 0) && (
                  <div className="mb-4">
                    <h3 className="text-lg font-medium mb-2">Data Issues</h3>
                    {consistency.issues.orphanedTracks.count > 0 && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded mb-2">
                        <div className="font-medium text-red-800">
                          Orphaned Tracks:{' '}
                          {consistency.issues.orphanedTracks.count}
                        </div>
                        <div className="text-sm text-red-600 mt-1">
                          Tracks referenced in playlists but missing from tracks
                          table
                        </div>
                        {consistency.issues.orphanedTracks.examples.length >
                          0 && (
                          <div className="text-xs text-red-500 mt-1">
                            Examples:{' '}
                            {consistency.issues.orphanedTracks.examples
                              .map(
                                (ex: any) =>
                                  `${ex.trackId} (playlist: ${ex.playlistId})`,
                              )
                              .join(', ')}
                          </div>
                        )}
                      </div>
                    )}
                    {consistency.issues.unreferencedTracks.count > 0 && (
                      <div className="p-3 bg-yellow-50 border border-yellow-200 rounded mb-2">
                        <div className="font-medium text-yellow-800">
                          Unreferenced Tracks:{' '}
                          {consistency.issues.unreferencedTracks.count}
                        </div>
                        <div className="text-sm text-yellow-600 mt-1">
                          Tracks in tracks table but not in any playlist (may be
                          in albums)
                        </div>
                        {consistency.issues.unreferencedTracks.examples.length >
                          0 && (
                          <div className="text-xs text-yellow-500 mt-1">
                            Examples:{' '}
                            {consistency.issues.unreferencedTracks.examples.join(
                              ', ',
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {consistency.issues.trulyOrphanedTracks.count > 0 && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded">
                        <div className="font-medium text-red-800">
                          Truly Orphaned Tracks:{' '}
                          {consistency.issues.trulyOrphanedTracks.count}
                        </div>
                        <div className="text-sm text-red-600 mt-1">
                          Tracks not referenced in any playlist or album
                        </div>
                        {consistency.issues.trulyOrphanedTracks.examples
                          .length > 0 && (
                          <div className="text-xs text-red-500 mt-1">
                            Examples:{' '}
                            {consistency.issues.trulyOrphanedTracks.examples.join(
                              ', ',
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Conclusion */}
                <div className="p-3 bg-blue-50 border border-blue-200 rounded">
                  <div className="font-medium text-blue-800 mb-1">
                    Conclusion
                  </div>
                  <div className="text-sm text-blue-700">
                    {consistency.analysis.isConsistent ? (
                      <span>
                        ✅ Your data is consistent! The difference between total
                        tracks (
                        {consistency.summary.totalTracks.toLocaleString()}) and
                        playlist tracks (
                        {consistency.summary.totalPlaylistTracks.toLocaleString()}
                        ) is due to
                        {consistency.analysis.expectedDifference.toLocaleString()}{' '}
                        tracks appearing in multiple playlists.
                      </span>
                    ) : (
                      <span>
                        ❌ Data inconsistency detected. You have{' '}
                        {consistency.issues.orphanedTracks.count} orphaned
                        tracks, {consistency.issues.unreferencedTracks.count}{' '}
                        unreferenced tracks, and{' '}
                        {consistency.issues.trulyOrphanedTracks.count} truly
                        orphaned tracks.
                      </span>
                    )}
                  </div>

                  {/* Cleanup Button */}
                  {consistency.issues.trulyOrphanedTracks.count > 0 && (
                    <div className="mt-3">
                      <button
                        onClick={cleanOrphanedTracks}
                        disabled={cleaning}
                        className="bg-red-500 hover:bg-red-600 disabled:bg-gray-400 text-white px-4 py-2 rounded text-sm">
                        {cleaning
                          ? 'Cleaning...'
                          : 'Clean Up Truly Orphaned Tracks'}
                      </button>
                      <p className="text-xs text-blue-600 mt-1">
                        This will delete{' '}
                        {consistency.issues.trulyOrphanedTracks.count} truly
                        orphaned tracks (not in any playlist or album)
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error State */}
        {status === 'error' && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <h2 className="text-xl font-semibold text-red-800 mb-2">
              Database Error
            </h2>
            <p className="text-red-600">{error}</p>
            <button
              onClick={() => setStatus('idle')}
              className="mt-4 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded">
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
