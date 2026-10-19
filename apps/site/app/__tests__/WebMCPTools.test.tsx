/**
 * @jest-environment jsdom
 */

import {render} from '@testing-library/react';
import WebMCPTools from '../WebMCPTools';

let mockPathname = '/find-music';

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

jest.mock('../../lib/local-db/client', () => ({
  runRawSql: jest.fn(),
}));

describe('WebMCPTools', () => {
  const registerTool = jest.fn();
  const unregisterTool = jest.fn();

  beforeEach(() => {
    mockPathname = '/chart-editor';
    window.history.replaceState({}, '', '/chart-editor');
    registerTool.mockReset();
    unregisterTool.mockReset();
    Object.defineProperty(navigator, 'modelContext', {
      configurable: true,
      value: {registerTool, unregisterTool},
    });
  });

  it.each([
    '/apple-music-connect',
    '/apple-music-connect/',
    '/find-music',
    '/find-music/recommendations',
  ])('does not register WebMCP tools on %s', pathname => {
    mockPathname = pathname;
    render(<WebMCPTools />);

    expect(registerTool).not.toHaveBeenCalled();
  });

  it('registers WebMCP tools on ordinary routes', () => {
    mockPathname = '/chart-editor';
    render(<WebMCPTools />);

    expect(registerTool).toHaveBeenCalled();
  });

  it('does not expose Apple Music library tables through raw SQL', async () => {
    mockPathname = '/chart-editor';
    render(<WebMCPTools />);
    const runSql = registerTool.mock.calls
      .map(
        ([tool]) =>
          tool as {
            name: string;
            execute: (args: {sql: string}) => Promise<unknown>;
          },
      )
      .find(tool => tool.name === 'run_sql');

    await expect(
      runSql?.execute({sql: 'SELECT * FROM apple_music_tracks'}),
    ).resolves.toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'Personal music tables are unavailable to WebMCP',
          }),
        },
      ],
    });
    const {runRawSql} = jest.requireMock('../../lib/local-db/client') as {
      runRawSql: jest.Mock;
    };
    expect(runRawSql).not.toHaveBeenCalled();
  });

  it('does not expose the local music database as text', async () => {
    mockPathname = '/chart-editor';
    render(<WebMCPTools />);
    const readText = registerTool.mock.calls
      .map(
        ([tool]) =>
          tool as {
            name: string;
            execute: (args: {path: string}) => Promise<unknown>;
          },
      )
      .find(tool => tool.name === 'opfs_read_text');

    await expect(
      readText?.execute({path: 'spotify-clonehero-local.sqlite3'}),
    ).resolves.toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'Personal music database files are unavailable to WebMCP',
          }),
        },
      ],
    });
  });

  it('unregisters on a taste-data route and registers only once on return', () => {
    mockPathname = '/chart-editor';
    const {rerender} = render(<WebMCPTools />);
    const registeredCount = registerTool.mock.calls.length;

    mockPathname = '/find-music';
    rerender(<WebMCPTools />);
    expect(unregisterTool).toHaveBeenCalledTimes(registeredCount);
    expect(registerTool).toHaveBeenCalledTimes(registeredCount);

    mockPathname = '/chart-editor';
    rerender(<WebMCPTools />);
    expect(registerTool).toHaveBeenCalledTimes(registeredCount * 2);
  });

  it('guards retained executors when unregisterTool is unavailable', async () => {
    Object.defineProperty(navigator, 'modelContext', {
      configurable: true,
      value: {registerTool},
    });
    const {rerender} = render(<WebMCPTools />);
    const runSql = registerTool.mock.calls
      .map(
        ([tool]) =>
          tool as {
            name: string;
            execute: (args: {sql: string}) => Promise<unknown>;
          },
      )
      .find(tool => tool.name === 'run_sql');

    mockPathname = '/find-music';
    window.history.pushState({}, '', '/find-music');
    rerender(<WebMCPTools />);

    await expect(runSql?.execute({sql: 'SELECT 1'})).resolves.toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'WebMCP tools are unavailable on personal taste-data routes',
          }),
        },
      ],
    });
    const {runRawSql} = jest.requireMock('../../lib/local-db/client') as {
      runRawSql: jest.Mock;
    };
    expect(runRawSql).not.toHaveBeenCalled();
  });
});
