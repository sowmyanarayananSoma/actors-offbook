import { useEffect, useState } from 'react';
import { View, FlatList, StyleSheet, Alert } from 'react-native';
import {
  Text,
  Card,
  FAB,
  useTheme,
  ActivityIndicator,
  Portal,
  Modal,
  TextInput,
  Button,
  Chip,
  Divider,
} from 'react-native-paper';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProjectStore } from '@/stores/projectStore';
import type { Project } from '@/types';

const PROJECT_TYPES: Project['type'][] = ['play', 'film', 'tv', 'commercial', 'other'];

export default function ProjectsScreen() {
  const theme = useTheme();
  const { projects, loadProjects, createProject, deleteProject, isLoading } = useProjectStore();
  const [showModal, setShowModal] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<Project['type']>('play');

  useEffect(() => {
    loadProjects();
  }, []);

  const handleCreate = async () => {
    if (!title.trim()) return;
    const project = await createProject({ title: title.trim(), type });
    setTitle('');
    setType('play');
    setShowModal(false);
    router.push(`/project/${project.id}`);
  };

  const handleDelete = (project: Project) => {
    Alert.alert(
      'Delete Project',
      `Are you sure you want to delete "${project.title}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteProject(project.id),
        },
      ]
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 48 }} />
      ) : projects.length === 0 ? (
        <View style={styles.empty}>
          <Text
            variant="bodyLarge"
            style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}
          >
            No projects yet.{'\n'}Tap + to create your first project.
          </Text>
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Card
              style={styles.card}
              onPress={() => router.push(`/project/${item.id}`)}
              onLongPress={() => handleDelete(item)}
            >
              <Card.Content style={styles.cardContent}>
                <View style={{ flex: 1 }}>
                  <Text variant="titleMedium">{item.title}</Text>
                  <Text
                    variant="bodySmall"
                    style={{
                      color: theme.colors.onSurfaceVariant,
                      textTransform: 'capitalize',
                    }}
                  >
                    {item.type}
                  </Text>
                </View>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {item.updatedAt.toLocaleDateString()}
                </Text>
              </Card.Content>
            </Card>
          )}
          contentContainerStyle={{ paddingBottom: 100 }}
        />
      )}

      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        onPress={() => setShowModal(true)}
      />

      <Portal>
        <Modal
          visible={showModal}
          onDismiss={() => setShowModal(false)}
          contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}
        >
          <Text variant="headlineSmall" style={{ marginBottom: 16 }}>
            New Project
          </Text>
          <TextInput
            label="Project title"
            value={title}
            onChangeText={setTitle}
            mode="outlined"
            autoFocus
            style={{ marginBottom: 16 }}
          />
          <Text
            variant="labelMedium"
            style={{ marginBottom: 8, color: theme.colors.onSurfaceVariant }}
          >
            Type
          </Text>
          <View style={styles.chipRow}>
            {PROJECT_TYPES.map((t) => (
              <Chip
                key={t}
                selected={type === t}
                onPress={() => setType(t)}
                style={{ marginRight: 8, marginBottom: 8 }}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Chip>
            ))}
          </View>
          <Divider style={{ marginVertical: 16 }} />
          <View style={styles.modalButtons}>
            <Button onPress={() => setShowModal(false)}>Cancel</Button>
            <Button mode="contained" onPress={handleCreate} disabled={!title.trim()}>
              Create
            </Button>
          </View>
        </Modal>
      </Portal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  card: { marginHorizontal: 16, marginTop: 8 },
  cardContent: { flexDirection: 'row', alignItems: 'center' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  fab: { position: 'absolute', right: 16, bottom: 24 },
  modal: { margin: 24, padding: 24, borderRadius: 16 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});
