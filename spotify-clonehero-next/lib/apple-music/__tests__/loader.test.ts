/**
 * @jest-environment jsdom
 */

import {fireEvent} from '@testing-library/react';
import {loadMusicKitScript} from '@/lib/apple-music/loader';

function clearMusicKit(): void {
  delete (window as Window & {MusicKit?: unknown}).MusicKit;
  document
    .querySelectorAll('script[data-music-kit-sdk="true"]')
    .forEach(node => {
      node.remove();
    });
}

function installMusicKitGlobal(): void {
  (window as Window & {MusicKit?: unknown}).MusicKit = {};
}

describe('loadMusicKitScript', () => {
  beforeEach(() => {
    clearMusicKit();
  });

  it('inserts one executable script and dedupes concurrent loads', async () => {
    const first = loadMusicKitScript();
    const second = loadMusicKitScript();
    const script = document.querySelector<HTMLScriptElement>(
      'script[data-music-kit-sdk="true"]',
    );

    expect(first).toBe(second);
    expect(script).toHaveAttribute(
      'src',
      'https://js-cdn.music.apple.com/musickit/v3/musickit.js',
    );
    expect(script).toHaveAttribute('crossorigin', 'anonymous');
    installMusicKitGlobal();
    fireEvent.load(script!);
    await expect(first).resolves.toBeUndefined();
    expect(document.head.contains(script!)).toBe(true);
  });

  it('rejects and removes a script created by this loader when it errors', async () => {
    const pending = loadMusicKitScript();
    const script = document.querySelector<HTMLScriptElement>(
      'script[data-music-kit-sdk="true"]',
    );

    fireEvent.error(script!);
    await expect(pending).rejects.toThrow('MusicKit failed to load');
    expect(document.head.contains(script!)).toBe(false);
  });

  it('resolves without inserting another tag when MusicKit is already global', async () => {
    installMusicKitGlobal();

    await expect(loadMusicKitScript()).resolves.toBeUndefined();
    expect(
      document.querySelector('script[data-music-kit-sdk="true"]'),
    ).toBeNull();
  });
});
