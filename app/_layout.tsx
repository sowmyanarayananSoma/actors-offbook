import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { PaperProvider, MD3DarkTheme, MD3LightTheme } from 'react-native-paper';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme, View } from 'react-native';
import { initDatabase } from '@/db/database';
import { useSettingsStore } from '@/stores/settingsStore';
import { configureAudioSession } from '@/services/audioSession';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { loadSettings, theme } = useSettingsStore();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    async function init() {
      await initDatabase();
      await loadSettings();
      await configureAudioSession();
      setIsReady(true);
    }
    init();
  }, []);

  const effectiveScheme =
    theme === 'auto' ? colorScheme : theme;
  const paperTheme = effectiveScheme === 'dark' ? MD3DarkTheme : MD3LightTheme;

  // Don't render any routes until DB is initialized — prevents "Database not
  // initialized" errors from stores that call getDb() on first render.
  if (!isReady) {
    return (
      <View style={{ flex: 1, backgroundColor: paperTheme.colors.background }} />
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PaperProvider theme={paperTheme}>
          <StatusBar style={effectiveScheme === 'dark' ? 'light' : 'dark'} />
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="project/[id]"
              options={{ headerShown: true, title: 'Project' }}
            />
            <Stack.Screen
              name="project/scene/[id]"
              options={{ headerShown: true, title: 'Scene' }}
            />
            <Stack.Screen
              name="project/practice/[id]"
              options={{ headerShown: false, presentation: 'fullScreenModal' }}
            />
            <Stack.Screen
              name="project/record/[id]"
              options={{ headerShown: true, title: 'Record Voices' }}
            />
            <Stack.Screen
              name="project/import/[id]"
              options={{ headerShown: true, title: 'Review Import' }}
            />
          </Stack>
        </PaperProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
