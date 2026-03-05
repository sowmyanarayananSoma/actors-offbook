import { Audio } from 'expo-av';

/**
 * Configures the audio session for background playback.
 * Must be called once at app startup.
 *
 * NOTE: Background audio and lock screen controls require a dev build
 * (npx eas build --profile development). They do NOT work in Expo Go.
 */
export async function configureAudioSession(): Promise<void> {
  try {
    await Audio.setAudioModeAsync({
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      interruptionModeIOS: 1, // INTERRUPTION_MODE_IOS_DUCK_OTHERS
      interruptionModeAndroid: 1, // INTERRUPTION_MODE_ANDROID_DUCK_OTHERS
      shouldDuckAndroid: true,
      allowsRecordingIOS: false,
    });
  } catch (err) {
    // Audio session configuration is non-critical; log but don't throw
    console.warn('[audioSession] Failed to configure audio mode:', err);
  }
}
