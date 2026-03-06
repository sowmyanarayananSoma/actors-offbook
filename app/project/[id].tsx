import { useEffect, useState } from 'react';
import { View, FlatList, StyleSheet, Alert } from 'react-native';
import {
  Text,
  Card,
  FAB,
  useTheme,
  ActivityIndicator,
  Chip,
  Portal,
  Modal,
  TextInput,
  Button,
  Divider,
} from 'react-native-paper';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProjectStore } from '@/stores/projectStore';
import { useSceneStore } from '@/stores/sceneStore';
import type { Scene } from '@/types';

const MASTERY_COLORS: Record<Scene['masteryStatus'], string> = {
  not_started: '#6B7280',
  needs_work: '#F59E0B',
  mastered: '#10B981',
};

const MASTERY_LABELS: Record<Scene['masteryStatus'], string> = {
  not_started: 'Not started',
  needs_work: 'Needs work',
  mastered: 'Mastered',
};

export default function ProjectDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const { currentProject, loadProject, isLoading: projectLoading } = useProjectStore();
  const { scenes, loadScenes, createScene, deleteScene, isLoading: sceneLoading } = useSceneStore();

  const [showAddScene, setShowAddScene] = useState(false);
  const [sceneTitle, setSceneTitle] = useState('');

  useEffect(() => {
    if (id) {
      loadProject(id);
      loadScenes(id);
    }
  }, [id]);

  useEffect(() => {
    if (currentProject) {
      navigation.setOptions({ title: currentProject.title });
    }
  }, [currentProject]);

  const handleAddScene = async () => {
    if (!sceneTitle.trim() || !id) return;
    const sceneNumber = String(scenes.length + 1);
    const scene = await createScene({
      projectId: id,
      sceneNumber,
      title: sceneTitle.trim(),
      sortOrder: scenes.length,
    });
    setSceneTitle('');
    setShowAddScene(false);
    router.push(`/project/scene/${scene.id}`);
  };

  const handleDeleteScene = (scene: Scene) => {
    Alert.alert(
      'Delete Scene',
      `Delete "${scene.title}"? All lines will be lost.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteScene(scene.id),
        },
      ]
    );
  };

  const isLoading = projectLoading || sceneLoading;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={['bottom']}
    >
      {isLoading && !currentProject ? (
        <ActivityIndicator style={{ marginTop: 48 }} />
      ) : (
        <>
          {currentProject && (
            <View style={[styles.header, { backgroundColor: theme.colors.surfaceVariant }]}>
              <Chip compact>{currentProject.type.toUpperCase()}</Chip>
            </View>
          )}

          {scenes.length === 0 ? (
            <View style={styles.empty}>
              <Text
                variant="bodyLarge"
                style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}
              >
                No scenes yet.{'\n'}Tap + to add a scene.
              </Text>
            </View>
          ) : (
            <FlatList
              data={scenes}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <Card
                  style={styles.card}
                  onPress={() => router.push(`/project/scene/${item.id}`)}
                  onLongPress={() => handleDeleteScene(item)}
                >
                  <Card.Content style={styles.cardContent}>
                    <View style={{ flex: 1 }}>
                      <Text
                        variant="labelSmall"
                        style={{ color: theme.colors.onSurfaceVariant }}
                      >
                        Scene {item.sceneNumber}
                      </Text>
                      <Text variant="titleMedium">{item.title}</Text>
                    </View>
                    <View
                      style={[
                        styles.masteryBadge,
                        { backgroundColor: MASTERY_COLORS[item.masteryStatus] },
                      ]}
                    >
                      <Text variant="labelSmall" style={{ color: '#fff' }}>
                        {MASTERY_LABELS[item.masteryStatus]}
                      </Text>
                    </View>
                  </Card.Content>
                </Card>
              )}
              contentContainerStyle={{ paddingBottom: 120 }}
            />
          )}
        </>
      )}

      <View style={styles.fabGroup}>
        <FAB
          icon="plus"
          style={[styles.fab, { backgroundColor: theme.colors.primary }]}
          onPress={() => setShowAddScene(true)}
        />
      </View>

      <Portal>
        <Modal
          visible={showAddScene}
          onDismiss={() => setShowAddScene(false)}
          contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}
        >
          <Text variant="headlineSmall" style={{ marginBottom: 16 }}>
            Add Scene
          </Text>
          <TextInput
            label="Scene title"
            value={sceneTitle}
            onChangeText={setSceneTitle}
            mode="outlined"
            autoFocus
            style={{ marginBottom: 16 }}
          />
          <Divider style={{ marginBottom: 16 }} />
          <View style={styles.modalButtons}>
            <Button onPress={() => setShowAddScene(false)}>Cancel</Button>
            <Button mode="contained" onPress={handleAddScene} disabled={!sceneTitle.trim()}>
              Add
            </Button>
          </View>
        </Modal>
      </Portal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingVertical: 12 },
  card: { marginHorizontal: 16, marginTop: 8 },
  cardContent: { flexDirection: 'row', alignItems: 'center' },
  masteryBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  fabGroup: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    alignItems: 'flex-end',
    gap: 12,
  },
  fab: {},
  fabSecondary: {},
  modal: { margin: 24, padding: 24, borderRadius: 16 },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});
