'use client';

import {useState} from 'react';
import {
  getLocalDb,
  checkLocalDbHealth,
  getLocalDbStats,
} from '@/lib/local-db/client';

export default function TestSQLocalPage() {
  const [status, setStatus] = useState<
    'idle' | 'initializing' | 'ready' | 'error'
  >('idle');
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<boolean | null>(null);
  const [stats, setStats] = useState<any>(null);
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

      // Nothing else to load here
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Database initialization failed:', err);
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

        {/* Ready state content placeholder */}
        {status === 'ready' && (
          <div className="bg-white border rounded-lg p-4">
            <h2 className="text-xl font-semibold mb-4">Local DB Ready</h2>
            <p className="text-gray-600">
              Migrations have been applied and the database is ready.
            </p>
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
