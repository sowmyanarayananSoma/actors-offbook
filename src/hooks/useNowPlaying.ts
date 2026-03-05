import { useEffect } from 'react';

interface NowPlayingInfo {
  title: string;
  artist: string;
  album: string;
  lineIndex: number;
  totalLines: number;
}

/**
 * Updates lock screen Now Playing metadata during practice sessions.
 *
 * Phase 1: Logs metadata changes for development visibility.
 * Full MPNowPlayingInfoCenter integration requires a native module (Phase 3).
 *
 * Background audio continuity is handled by the audio session configuration
 * in audioSession.ts. The iOS audio session stays active as long as
 * expo-speech is driving audio output.
 *
 * NOTE: Background audio requires a dev build — not supported in Expo Go.
 */
export function useNowPlaying(info: NowPlayingInfo): void {
  useEffect(() => {
    if (__DEV__) {
      console.log(
        `[NowPlaying] ${info.album} › ${info.title} — ${info.artist} (${info.lineIndex}/${info.totalLines})`
      );
    }
    // Phase 3: integrate with @react-native-community/hooks or a native module
    // to set MPNowPlayingInfoCenter metadata for real lock screen controls.
  }, [info.title, info.artist, info.lineIndex, info.album, info.totalLines]);
}
