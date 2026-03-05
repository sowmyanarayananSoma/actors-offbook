import { View, StyleSheet } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import type { Line, Character } from '@/types';

interface Props {
  line: Line;
  character?: Character;
}

export function LineRow({ line, character }: Props) {
  const theme = useTheme();

  if (line.isStageDirection) {
    return (
      <View style={styles.stageDirection}>
        <Text
          variant="bodySmall"
          style={[styles.stageText, { color: theme.colors.onSurfaceVariant }]}
        >
          {line.text}
        </Text>
      </View>
    );
  }

  const charColor = character?.color ?? theme.colors.primary;
  const charName = character?.name ?? 'Unknown';

  return (
    <View style={styles.lineRow}>
      <Text variant="labelMedium" style={[styles.charName, { color: charColor }]}>
        {charName}
        {character?.isActor && <Text style={{ color: charColor }}> {'\u25CF'}</Text>}
      </Text>
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurface }}>
        {line.text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  lineRow: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  charName: {
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 2,
    letterSpacing: 0.5,
  },
  stageDirection: {
    paddingHorizontal: 24,
    paddingVertical: 4,
  },
  stageText: {
    fontStyle: 'italic',
  },
});
