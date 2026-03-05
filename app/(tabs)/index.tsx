import { useEffect } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { Text, Card, FAB, useTheme, ActivityIndicator } from 'react-native-paper';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProjectStore } from '@/stores/projectStore';

export default function HomeScreen() {
  const theme = useTheme();
  const { projects, loadProjects, isLoading } = useProjectStore();
  const recentProjects = projects.slice(0, 3);

  useEffect(() => {
    loadProjects();
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <Text variant="headlineMedium" style={{ color: theme.colors.onBackground }}>
          Actors Offbook
        </Text>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          Your lines. Your voice. Mastered.
        </Text>
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 32 }} />
      ) : recentProjects.length === 0 ? (
        <View style={styles.empty}>
          <Text
            variant="bodyLarge"
            style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}
          >
            No projects yet.{'\n'}Tap + to create your first project.
          </Text>
        </View>
      ) : (
        <>
          <Text
            variant="titleMedium"
            style={[styles.sectionTitle, { color: theme.colors.onBackground }]}
          >
            Recent Projects
          </Text>
          <FlatList
            data={recentProjects}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Card
                style={styles.card}
                onPress={() => router.push(`/project/${item.id}`)}
              >
                <Card.Content>
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
                </Card.Content>
              </Card>
            )}
            contentContainerStyle={{ paddingBottom: 100 }}
          />
        </>
      )}

      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        onPress={() => router.push('/projects')}
        label="New Project"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, paddingBottom: 8 },
  sectionTitle: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  card: { marginHorizontal: 16, marginBottom: 8 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  fab: { position: 'absolute', right: 16, bottom: 24 },
});
