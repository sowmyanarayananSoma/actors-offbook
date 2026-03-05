import { View, StyleSheet } from 'react-native';
import {
  Text,
  List,
  Divider,
  useTheme,
  SegmentedButtons,
  Button,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettingsStore } from '@/stores/settingsStore';
import type { PromptLevel } from '@/types';

export default function SettingsScreen() {
  const theme = useTheme();
  const {
    promptLevel,
    setPromptLevel,
    playbackSpeed,
    setPlaybackSpeed,
    theme: appTheme,
    setTheme,
  } = useSettingsStore();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <List.Section>
        <List.Subheader>Practice</List.Subheader>
        <View style={styles.settingRow}>
          <Text
            variant="bodyLarge"
            style={{ color: theme.colors.onBackground, marginBottom: 4 }}
          >
            Mute Prompt Level
          </Text>
          <Text
            variant="bodySmall"
            style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12 }}
          >
            What to show when your line is being skipped
          </Text>
          <SegmentedButtons
            value={promptLevel}
            onValueChange={(v) => setPromptLevel(v as PromptLevel)}
            buttons={[
              { value: 'hidden', label: 'Hidden' },
              { value: 'first_word', label: 'First Word' },
              { value: 'full_text', label: 'Full Text' },
            ]}
          />
        </View>
        <Divider />
        <View style={styles.settingRow}>
          <Text
            variant="bodyLarge"
            style={{ color: theme.colors.onBackground, marginBottom: 12 }}
          >
            Playback Speed
          </Text>
          <View style={styles.speedRow}>
            <Button
              compact
              mode="outlined"
              onPress={() =>
                setPlaybackSpeed(Math.max(0.5, parseFloat((playbackSpeed - 0.1).toFixed(1))))
              }
            >
              −
            </Button>
            <Text variant="bodyLarge" style={{ color: theme.colors.primary, minWidth: 48, textAlign: 'center' }}>
              {playbackSpeed.toFixed(1)}x
            </Text>
            <Button
              compact
              mode="outlined"
              onPress={() =>
                setPlaybackSpeed(Math.min(2.0, parseFloat((playbackSpeed + 0.1).toFixed(1))))
              }
            >
              +
            </Button>
          </View>
        </View>
      </List.Section>

      <Divider />

      <List.Section>
        <List.Subheader>Appearance</List.Subheader>
        <View style={styles.settingRow}>
          <Text
            variant="bodyLarge"
            style={{ color: theme.colors.onBackground, marginBottom: 12 }}
          >
            Theme
          </Text>
          <SegmentedButtons
            value={appTheme}
            onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'auto')}
            buttons={[
              { value: 'light', label: 'Light' },
              { value: 'auto', label: 'Auto' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </View>
      </List.Section>

      <Divider />

      <List.Section>
        <List.Subheader>About</List.Subheader>
        <List.Item title="Actors Offbook" description="Version 1.0.0" />
        <List.Item title="Built for actors" description="Memorize your lines, your way." />
      </List.Section>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  settingRow: { paddingHorizontal: 16, paddingVertical: 12 },
  speedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
});
