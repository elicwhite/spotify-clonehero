'use client';

import React, {
  ReactNode,
  createContext,
  useCallback,
  useRef,
  useState,
} from 'react';

interface AudioContextProps {
  isPlaying: boolean;
  currentTrack: {artist: string; song: string} | null;
  playTrack: (artist: string, song: string, audioUrl: string) => void;
  pause: () => void;
}

export const AudioContext = createContext<AudioContextProps>({
  isPlaying: false,
  currentTrack: null,
  playTrack: () => {},
  pause: () => {},
});

export function AudioProvider({children}: {children: ReactNode}) {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTrack, setCurrentTrack] = useState<{
    artist: string;
    song: string;
  } | null>(null);

  const pause = useCallback(() => {
    if (audioRef.current != null) {
      audioRef.current.pause();
    }

    setIsPlaying(false);
    setCurrentTrack(null);
  }, []);

  const playTrack = useCallback(
    async (artist: string, song: string, audioUrl: string) => {
      pause();

      if (audioRef.current == null) {
        audioRef.current = new Audio();
      }

      audioRef.current.src = audioUrl;
      audioRef.current.loop = true;
      await audioRef.current.play();
      setIsPlaying(true);
      setCurrentTrack({artist, song});
    },
    [pause],
  );

  return (
    <AudioContext.Provider value={{isPlaying, currentTrack, playTrack, pause}}>
      {children}
    </AudioContext.Provider>
  );
}
