import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { AppSettings, PromptLevel } from '@/types';

const STORAGE_KEY = 'app_settings';

const DEFAULT_SETTINGS: AppSettings = {
  promptLevel: 'first_word',
  playbackSpeed: 1.0,
  theme: 'auto',
};

interface SettingsStore extends AppSettings {
  isLoaded: boolean;
  loadSettings: () => Promise<void>;
  setPromptLevel: (level: PromptLevel) => Promise<void>;
  setPlaybackSpeed: (speed: number) => Promise<void>;
  setTheme: (theme: AppSettings['theme']) => Promise<void>;
}

async function persist(settings: AppSettings): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(settings));
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...DEFAULT_SETTINGS,
  isLoaded: false,

  loadSettings: async () => {
    try {
      const stored = await SecureStore.getItemAsync(STORAGE_KEY);
      if (stored) {
        const parsed: AppSettings = JSON.parse(stored);
        set({ ...parsed, isLoaded: true });
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
  },

  setPromptLevel: async (promptLevel) => {
    const next = { ...get(), promptLevel };
    set({ promptLevel });
    await persist(next);
  },

  setPlaybackSpeed: async (playbackSpeed) => {
    const next = { ...get(), playbackSpeed };
    set({ playbackSpeed });
    await persist(next);
  },

  setTheme: async (theme) => {
    const next = { ...get(), theme };
    set({ theme });
    await persist(next);
  },
}));
