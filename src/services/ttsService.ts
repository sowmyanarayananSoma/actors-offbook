import * as Speech from 'expo-speech';
import type { VoiceSettings } from '@/types';

/**
 * Words per minute rate at 1.0x speed — used for duration estimation.
 * Average adult speaking pace ≈ 130 wpm.
 */
const BASE_WORDS_PER_MINUTE = 130;

let isSpeaking = false;

/**
 * Speaks text using expo-speech. Returns a Promise that resolves when
 * speech finishes (or immediately on error).
 */
export function speak(
  text: string,
  settings: VoiceSettings,
  onDone?: () => void
): void {
  if (isSpeaking) {
    Speech.stop();
  }
  isSpeaking = true;

  Speech.speak(text, {
    language: settings.language,
    pitch: settings.pitch,
    rate: settings.rate,
    onDone: () => {
      isSpeaking = false;
      onDone?.();
    },
    onError: () => {
      isSpeaking = false;
      onDone?.();
    },
    onStopped: () => {
      isSpeaking = false;
    },
  });
}

/**
 * Stops current speech immediately.
 */
export function stop(): void {
  if (isSpeaking) {
    Speech.stop();
    isSpeaking = false;
  }
}

/**
 * Estimates the duration of spoken text in milliseconds.
 * Formula: (words / WPM) * 60 * 1000 / rate, with minimum 500ms.
 */
export function estimateDurationMs(text: string, rate: number): number {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount === 0) return 500;
  const minutes = wordCount / BASE_WORDS_PER_MINUTE;
  const ms = (minutes * 60 * 1000) / Math.max(0.1, rate);
  // Add 300ms buffer for pauses between words
  return Math.max(500, Math.round(ms) + 300);
}

/**
 * Gets all voices available on the device via expo-speech.
 */
export async function getAvailableVoices(): Promise<Speech.Voice[]> {
  try {
    return await Speech.getAvailableVoicesAsync();
  } catch {
    return [];
  }
}

/**
 * Preview a character's voice by speaking a sample line.
 */
export function previewVoice(characterName: string, settings: VoiceSettings): void {
  speak(`Hello. I am ${characterName}.`, settings);
}

/**
 * Returns whether TTS is currently active.
 */
export function getIsSpeaking(): boolean {
  return isSpeaking;
}
