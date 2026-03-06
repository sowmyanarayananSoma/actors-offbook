import { useCallback, useEffect, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { View, FlatList, StyleSheet, ScrollView, Alert, Dimensions } from 'react-native';
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
import { WebView } from 'react-native-webview';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProjectStore } from '@/stores/projectStore';
import { useSceneStore } from '@/stores/sceneStore';
import { LineRow } from '@/components/LineRow';
import { CharacterChip } from '@/components/CharacterChip';
import type { Character } from '@/types';

const SCREEN_HEIGHT = Dimensions.get('window').height;

function docPath(sceneId: string) {
  return `${FileSystem.documentDirectory ?? ''}docs/scene_${sceneId}.json`;
}

async function loadDocUri(sceneId: string): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(docPath(sceneId));
    if (!info.exists) return null;
    const json = await FileSystem.readAsStringAsync(docPath(sceneId));
    return JSON.parse(json).uri ?? null;
  } catch { return null; }
}

async function saveDocUri(sceneId: string, uri: string): Promise<void> {
  const dir = `${FileSystem.documentDirectory ?? ''}docs/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  await FileSystem.writeAsStringAsync(docPath(sceneId), JSON.stringify({ uri }));
}

async function clearDocUri(sceneId: string): Promise<void> {
  await FileSystem.deleteAsync(docPath(sceneId), { idempotent: true });
}

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
  const [docUri, setDocUri] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      const path = `${FileSystem.documentDirectory ?? ''}tracks/scene_${id}.json`;
      FileSystem.getInfoAsync(path).then((info) => setHasTrack(info.exists));
      loadDocUri(id).then(setDocUri);
    }, [id])
  );

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

  const handleAttachDoc = async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0] || !id) return;
    const picked = result.assets[0];
    // Copy to permanent location
    const dir = `${FileSystem.documentDirectory ?? ''}docs/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const ext = picked.name.split('.').pop() ?? 'pdf';
    const dest = `${dir}scene_${id}_doc.${ext}`;
    await FileSystem.copyAsync({ from: picked.uri, to: dest });
    await saveDocUri(id, dest);
    setDocUri(dest);
  };

  const handleRemoveDoc = async () => {
    if (!id) return;
    await clearDocUri(id);
    if (docUri) await FileSystem.deleteAsync(docUri, { idempotent: true }).catch(() => {});
    setDocUri(null);
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
      {/* Document viewer — flex: 1 when no lines so it fills space above character panel */}
      {docUri && (
        <View style={[styles.docPanel, lines.length === 0 && { flex: 1, height: undefined }, { borderBottomColor: theme.colors.outline }]}>
          <View style={styles.docHeader}>
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, flex: 1 }}>
              Script Document
            </Text>
            <IconButton
              icon="delete"
              size={18}
              onPress={() =>
                Alert.alert('Remove Document', 'Remove attached document?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: handleRemoveDoc },
                ])
              }
              iconColor={theme.colors.error}
            />
          </View>
          <WebView
            source={{ uri: docUri }}
            style={styles.docWebView}
            originWhitelist={['*']}
            allowFileAccess
            allowingReadAccessToURL={FileSystem.documentDirectory ?? undefined}
          />
        </View>
      )}

      {/* Script view — always provides flex: 1 to pin character panel to bottom */}
      {lines.length > 0 ? (
        <FlatList
          data={lines}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const character = characters.find((c) => c.id === item.characterId);
            return <LineRow line={item} character={character} />;
          }}
          contentContainerStyle={{ paddingBottom: 240 }}
          style={{ flex: 1 }}
        />
      ) : !docUri ? (
        <View style={{ flex: 1 }} />
      ) : null}

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
        <View style={styles.buttonRow}>
          <Button
            mode="outlined"
            icon={docUri ? 'file-replace' : 'file-plus'}
            onPress={handleAttachDoc}
            style={{ flex: 1, marginRight: 4 }}
            compact
          >
            {docUri ? 'Replace Script' : 'Attach Script'}
          </Button>
          <Button
            mode="outlined"
            icon="microphone"
            onPress={() => router.push(`/project/record/${id}`)}
            disabled={characters.length === 0}
            style={{ flex: 1, marginLeft: 4 }}
            compact
          >
            Record
          </Button>
        </View>
        <Button
          mode="contained"
          icon="play"
          onPress={() => router.push(`/project/practice/${id}`)}
          disabled={lines.length === 0 && !hasTrack}
          style={{ marginTop: 8 }}
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
  charPanel: { padding: 16, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  charRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 0 },
  modal: { margin: 24, padding: 24, borderRadius: 16 },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  docPanel: {
    height: SCREEN_HEIGHT * 0.35,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  docHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  docWebView: { flex: 1 },
});
