'use client';

import {usePathname} from 'next/navigation';
import React, {
  type ReactNode,
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

export type PreviewTrack = {
  key?: string;
  artist: string;
  song: string;
};

interface AudioContextProps {
  isPlaying: boolean;
  isLoading: boolean;
  currentTrack: PreviewTrack | null;
  /** Stops current playback and reserves the next preview action. */
  beginTrackRequest: () => number;
  isTrackRequestCurrent: (requestId: number) => boolean;
  playTrack: (
    artist: string,
    song: string,
    audioUrl: string,
    key?: string,
    requestId?: number,
  ) => Promise<void>;
  pause: () => void;
}

export const AudioContext = createContext<AudioContextProps>({
  isPlaying: false,
  isLoading: false,
  currentTrack: null,
  beginTrackRequest: () => 0,
  isTrackRequestCurrent: () => false,
  playTrack: async () => {},
  pause: () => {},
});

export function AudioProvider({children}: {children: ReactNode}) {
  const pathname = usePathname();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const removeAudioListenersRef = useRef<(() => void) | null>(null);
  const requestIdRef = useRef(0);
  const currentTrackRef = useRef<PreviewTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<PreviewTrack | null>(null);

  const setTrack = useCallback((track: PreviewTrack | null) => {
    currentTrackRef.current = track;
    setCurrentTrack(track);
  }, []);

  const releaseAudio = useCallback(() => {
    const audio = audioRef.current;
    removeAudioListenersRef.current?.();
    removeAudioListenersRef.current = null;
    audioRef.current = null;
    setTrack(null);
    setIsPlaying(false);
    setIsLoading(false);
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }, [setTrack]);

  const pause = useCallback(() => {
    requestIdRef.current += 1;
    releaseAudio();
  }, [releaseAudio]);

  const beginTrackRequest = useCallback(() => {
    const requestId = ++requestIdRef.current;
    releaseAudio();
    return requestId;
  }, [releaseAudio]);

  const isTrackRequestCurrent = useCallback(
    (requestId: number) => requestId === requestIdRef.current,
    [],
  );

  const ensureAudio = useCallback(() => {
    if (audioRef.current) return audioRef.current;
    const audio = new Audio();
    audio.loop = true;

    const onPlaying = () => {
      if (!currentTrackRef.current) return;
      setIsLoading(false);
      setIsPlaying(true);
    };
    const onWaiting = () => {
      if (!currentTrackRef.current) return;
      setIsLoading(true);
    };
    const onStopped = () => {
      if (!currentTrackRef.current) return;
      releaseAudio();
    };
    const onFailed = () => {
      if (!currentTrackRef.current) return;
      requestIdRef.current += 1;
      releaseAudio();
    };

    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('stalled', onWaiting);
    audio.addEventListener('pause', onStopped);
    audio.addEventListener('ended', onStopped);
    audio.addEventListener('error', onFailed);
    audio.addEventListener('abort', onFailed);
    removeAudioListenersRef.current = () => {
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('stalled', onWaiting);
      audio.removeEventListener('pause', onStopped);
      audio.removeEventListener('ended', onStopped);
      audio.removeEventListener('error', onFailed);
      audio.removeEventListener('abort', onFailed);
    };
    audioRef.current = audio;
    return audio;
  }, [releaseAudio]);

  const playTrack = useCallback(
    async (
      artist: string,
      song: string,
      audioUrl: string,
      key?: string,
      preparedRequestId?: number,
    ) => {
      const requestId = preparedRequestId ?? beginTrackRequest();
      if (!isTrackRequestCurrent(requestId)) return;

      const audio = ensureAudio();
      const track = {artist, song, ...(key ? {key} : {})};
      setTrack(track);
      setIsLoading(true);
      setIsPlaying(false);
      audio.src = audioUrl;
      audio.loop = true;

      try {
        await audio.play();
      } catch (error) {
        // Replacing a pending source rejects the previous play promise. That
        // stale request must not clear or overwrite the newer track.
        if (!isTrackRequestCurrent(requestId)) return;
        releaseAudio();
        throw error;
      }

      if (!isTrackRequestCurrent(requestId)) return;
      setIsLoading(false);
      setIsPlaying(true);
    },
    [
      beginTrackRequest,
      ensureAudio,
      isTrackRequestCurrent,
      releaseAudio,
      setTrack,
    ],
  );

  // The provider lives above the router, so a page unmount would otherwise
  // leave its preview playing. Effect cleanup runs before each pathname change.
  useEffect(() => () => pause(), [pathname, pause]);

  useEffect(
    () => () => {
      requestIdRef.current += 1;
      releaseAudio();
    },
    [releaseAudio],
  );

  return (
    <AudioContext.Provider
      value={{
        isPlaying,
        isLoading,
        currentTrack,
        beginTrackRequest,
        isTrackRequestCurrent,
        playTrack,
        pause,
      }}>
      {children}
    </AudioContext.Provider>
  );
}
