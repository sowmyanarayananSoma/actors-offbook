import { View, StyleSheet } from 'react-native';
import { Card, Text, useTheme } from 'react-native-paper';
import type { Scene } from '@/types';

interface Props {
  scene: Scene;
  onPress: () => void;
  onLongPress?: () => void;
}

const MASTERY_COLORS: Record<Scene['masteryStatus'], string> = {
  not_started: '#6B7280',
  needs_work: '#F59E0B',
  mastered: '#10B981',
};

export function SceneCard({ scene, onPress, onLongPress }: Props) {
  const theme = useTheme();
  const masteryColor = MASTERY_COLORS[scene.masteryStatus];

  return (
    <Card style={styles.card} onPress={onPress} onLongPress={onLongPress}>
      <Card.Content style={styles.content}>
        <View style={{ flex: 1 }}>
          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
            Scene {scene.sceneNumber}
          </Text>
          <Text variant="titleMedium">{scene.title}</Text>
          {scene.practiceStats.lastPracticed && (
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              Last practiced:{' '}
              {new Date(scene.practiceStats.lastPracticed).toLocaleDateString()}
            </Text>
          )}
        </View>
        <View style={[styles.badge, { backgroundColor: masteryColor }]}>
          <Text variant="labelSmall" style={{ color: '#fff' }}>
            {scene.masteryStatus.replace('_', ' ')}
          </Text>
        </View>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 8 },
  content: { flexDirection: 'row', alignItems: 'center' },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
});
