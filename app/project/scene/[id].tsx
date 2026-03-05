import { useEffect, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { View, FlatList, StyleSheet, ScrollView, Alert } from 'react-native';
import {
  Text,
  useTheme,
  ActivityIndicator,
  Button,
  Portal,
  Modal,
  TextInput,
  IconButton,
  Surface,
} from 'react-native-paper';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProjectStore } from '@/stores/projectStore';
import { useSceneStore } from '@/stores/sceneStore';
import { LineRow } from '@/components/LineRow';
import { CharacterChip } from '@/components/CharacterChip';
import type { Character } from '@/types';

const CHARACTER_COLORS = [
  '#6366F1',
  '#EC4899',
  '#10B981',
  '#F59E0B',
  '#3B82F6',
  '#EF4444',
  '#8B5CF6',
  '#14B8A6',
];

export default function SceneDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const {
    currentProject,
    characters,
    loadProject,
    createCharacter,
    deleteCharacter,
    setActorCharacter,
  } = useProjectStore();
  const { currentScene, lines, loadScene, isLoading } = useSceneStore();

  const [showAddChar, setShowAddChar] = useState(false);
  const [charName, setCharName] = useState('');
  const [hasTrack, setHasTrack] = useState(false);

  useEffect(() => {
    if (!id) return;
    const path = `${FileSystem.documentDirectory ?? ''}tracks/scene_${id}.json`;
    FileSystem.getInfoAsync(path).then((info) => setHasTrack(info.exists));
  }, [id]);

  useEffect(() => {
    if (id) {
      loadScene(id);
    }
  }, [id]);

  useEffect(() => {
    if (currentScene && !currentProject) {
      loadProject(currentScene.projectId);
    }
  }, [currentScene]);

  useEffect(() => {
    if (currentScene) {
      navigation.setOptions({ title: currentScene.title });
    }
  }, [currentScene]);

  const handleAddCharacter = async () => {
    if (!charName.trim() || !currentProject) return;
    const colorIndex = characters.length % CHARACTER_COLORS.length;
    await createCharacter({
      projectId: currentProject.id,
      name: charName.trim(),
      color: CHARACTER_COLORS[colorIndex],
      voiceSettings: { type: 'tts', pitch: 1.0, rate: 1.0, language: 'en-US' },
      isActor: false,
    });
    setCharName('');
    setShowAddChar(false);
  };

  const handleSetActor = (character: Character) => {
    if (!currentProject) return;
    setActorCharacter(currentProject.id, character.id);
  };

  const handleDeleteCharacter = (character: Character) => {
    Alert.alert(
      'Remove Character',
      `Remove "${character.name}" from this project?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => deleteCharacter(character.id),
        },
      ]
    );
  };

  if (isLoading || !currentScene) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={['bottom']}
    >
      {/* Script view */}
      <FlatList
        data={lines}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const character = characters.find((c) => c.id === item.characterId);
          return <LineRow line={item} character={character} />;
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              No lines yet. Add characters and import a script.
            </Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: 240 }}
      />

      {/* Character panel */}
      <Surface
        style={[styles.charPanel, { backgroundColor: theme.colors.surfaceVariant }]}
        elevation={4}
      >
        <Text
          variant="labelLarge"
          style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}
        >
          Characters
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginBottom: 12 }}
        >
          <View style={styles.charRow}>
            {characters.map((c) => (
              <CharacterChip
                key={c.id}
                character={c}
                onPress={() => handleSetActor(c)}
                onLongPress={() => handleDeleteCharacter(c)}
              />
            ))}
            <IconButton icon="account-plus" onPress={() => setShowAddChar(true)} />
          </View>
        </ScrollView>
        <Button
          mode="outlined"
          icon="microphone"
          onPress={() => router.push(`/project/record/${id}`)}
          disabled={characters.length === 0}
          style={{ marginBottom: 8 }}
        >
          Record Voices
        </Button>
        <Button
          mode="contained"
          icon="play"
          onPress={() => router.push(`/project/practice/${id}`)}
          disabled={lines.length === 0 && !hasTrack}
        >
          Practice this scene
        </Button>
      </Surface>

      <Portal>
        <Modal
          visible={showAddChar}
          onDismiss={() => setShowAddChar(false)}
          contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}
        >
          <Text variant="headlineSmall" style={{ marginBottom: 16 }}>
            Add Character
          </Text>
          <TextInput
            label="Character name"
            value={charName}
            onChangeText={setCharName}
            mode="outlined"
            autoFocus
            autoCapitalize="characters"
            style={{ marginBottom: 16 }}
          />
          <View style={styles.modalButtons}>
            <Button onPress={() => setShowAddChar(false)}>Cancel</Button>
            <Button mode="contained" onPress={handleAddCharacter} disabled={!charName.trim()}>
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
  empty: { padding: 32, alignItems: 'center' },
  charPanel: { padding: 16, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  charRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modal: { margin: 24, padding: 24, borderRadius: 16 },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});
