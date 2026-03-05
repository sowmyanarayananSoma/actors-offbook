import { useState, useCallback } from 'react';
import { View, FlatList, StyleSheet, Alert, ScrollView } from 'react-native';
import {
  Text, Button, useTheme, ActivityIndicator,
  Card, Chip, Divider, TextInput, IconButton, Surface
} from 'react-native-paper';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { parseScript } from '@/services/scriptParser';
import { extractTextFromPdf } from '@/services/pdfExtractor';
import { useProjectStore } from '@/stores/projectStore';
import { useSceneStore } from '@/stores/sceneStore';
import * as sceneRepo from '@/db/repositories/sceneRepo';
import * as characterRepo from '@/db/repositories/characterRepo';
import * as lineRepo from '@/db/repositories/lineRepo';
import { generateId } from '@/db/repositories/utils';
import type { ParsedScript, Character } from '@/types';

const CHARACTER_COLORS = [
  '#6366F1', '#EC4899', '#10B981', '#F59E0B',
  '#3B82F6', '#EF4444', '#8B5CF6', '#14B8A6',
];

export default function ImportScreen() {
  const theme = useTheme();
  const { id: projectId } = useLocalSearchParams<{ id: string }>();
  const { currentProject, characters, loadProject } = useProjectStore();
  const { loadScenes } = useSceneStore();

  const [parsed, setParsed] = useState<ParsedScript | null>(null);
  const [characterNames, setCharacterNames] = useState<string[]>([]);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handlePickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', 'text/*', 'application/pdf'],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];
      const isPdf =
        file.mimeType === 'application/pdf' ||
        file.name?.toLowerCase().endsWith('.pdf') === true;

      let content: string;

      if (isPdf) {
        setLoadingMessage('Extracting text from PDF…');
        content = await extractTextFromPdf(file.uri);
      } else {
        setLoadingMessage('Reading file…');
        content = await FileSystem.readAsStringAsync(file.uri, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      }

      setLoadingMessage('Parsing script…');
      const parsedScript = parseScript(content);
      setParsed(parsedScript);
      setCharacterNames(parsedScript.characters);
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      let message: string;
      if (rawMessage === 'SCANNED_PDF') {
        message = 'This PDF appears to be a scanned image with no text layer. Please use a digitally-created PDF (exported from Final Draft, WriterDuet, etc.) or a .txt file.';
      } else if (rawMessage.startsWith('PDF_ERROR')) {
        // Strip the prefix so the user (and dev) can see the underlying issue.
        const detail = rawMessage.slice('PDF_ERROR: '.length);
        message = `Could not extract text from this PDF.\n\n${detail}\n\nTry a different PDF or paste the script as a .txt file.`;
      } else {
        message = `Could not read the file.\n\n${rawMessage}`;
      }
      Alert.alert('Import Error', message);
    } finally {
      setLoadingMessage(null);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!parsed || !projectId) return;
    setIsSaving(true);

    try {
      // Ensure project is loaded
      if (!currentProject) {
        await loadProject(projectId);
      }

      // Create characters that don't already exist
      const existingNames = new Set(characters.map((c) => c.name.toLowerCase()));
      const charMap = new Map<string, Character>(
        characters.map((c) => [c.name.toLowerCase(), c])
      );

      for (let i = 0; i < characterNames.length; i++) {
        const name = characterNames[i];
        if (!existingNames.has(name.toLowerCase())) {
          const color = CHARACTER_COLORS[i % CHARACTER_COLORS.length];
          const char = await characterRepo.createCharacter({
            projectId,
            name,
            color,
            voiceSettings: { type: 'tts', pitch: 1.0, rate: 1.0, language: 'en-US' },
            isActor: false,
          });
          charMap.set(name.toLowerCase(), char);
          existingNames.add(name.toLowerCase());
        }
      }

      // Create scenes and lines
      for (let si = 0; si < parsed.scenes.length; si++) {
        const parsedScene = parsed.scenes[si];
        const existingScenes = await sceneRepo.getScenesByProject(projectId);
        const scene = await sceneRepo.createScene({
          projectId,
          sceneNumber: parsedScene.sceneNumber,
          title: parsedScene.title,
          sortOrder: existingScenes.length,
        });

        // Find a fallback character (or create a generic one)
        let fallbackCharId = charMap.values().next().value?.id;
        if (!fallbackCharId) {
          const fallback = await characterRepo.createCharacter({
            projectId,
            name: 'NARRATOR',
            color: '#6B7280',
            voiceSettings: { type: 'tts', pitch: 1.0, rate: 1.0, language: 'en-US' },
            isActor: false,
          });
          fallbackCharId = fallback.id;
          charMap.set('narrator', fallback);
        }

        const linesToCreate = parsedScene.lines.map((pl) => {
          const charName = pl.characterName?.toLowerCase() ?? '';
          const character = charMap.get(charName);
          return {
            sceneId: scene.id,
            characterId: character?.id ?? fallbackCharId!,
            text: pl.text,
            order: pl.order,
            isStageDirection: pl.isStageDirection,
          };
        });

        await lineRepo.bulkCreateLines(linesToCreate);
      }

      await loadScenes(projectId);
      router.back();
      router.back(); // go back to project detail
    } catch (err) {
      Alert.alert('Save Error', 'Could not save the script. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [parsed, projectId, characterNames, characters, currentProject]);

  const updateCharacterName = (index: number, newName: string) => {
    setCharacterNames((prev) => {
      const next = [...prev];
      next[index] = newName;
      return next;
    });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        {!parsed ? (
          <View style={styles.pickArea}>
            <Text variant="headlineSmall" style={{ color: theme.colors.onBackground, marginBottom: 8 }}>
              Import Script
            </Text>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 24, textAlign: 'center' }}>
              Select a .txt or .pdf file in standard screenplay format — character names in ALL CAPS on their own line, scene headings starting with INT. or EXT.
            </Text>
            {loadingMessage !== null ? (
              <View style={{ alignItems: 'center', gap: 12 }}>
                <ActivityIndicator />
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {loadingMessage}
                </Text>
              </View>
            ) : (
              <Button mode="contained" icon="file-upload" onPress={handlePickFile} style={{ marginBottom: 16 }}>
                Choose .txt or .pdf
              </Button>
            )}
          </View>
        ) : (
          <View style={styles.reviewArea}>
            {/* Characters section */}
            <Surface style={[styles.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
              <Text variant="titleMedium" style={{ marginBottom: 12 }}>
                Characters Detected
              </Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12 }}>
                Edit names or mark as duplicates. Long-press to remove.
              </Text>
              {characterNames.map((name, i) => (
                <View key={i} style={styles.charRow}>
                  <TextInput
                    value={name}
                    onChangeText={(v) => updateCharacterName(i, v)}
                    mode="outlined"
                    dense
                    style={{ flex: 1, marginRight: 8 }}
                  />
                  <IconButton
                    icon="close"
                    size={20}
                    onPress={() => setCharacterNames((prev) => prev.filter((_, idx) => idx !== i))}
                  />
                </View>
              ))}
            </Surface>

            <Divider style={{ marginVertical: 16 }} />

            {/* Scene preview */}
            <Text variant="titleMedium" style={{ paddingHorizontal: 16, marginBottom: 8 }}>
              {parsed.scenes.length} Scene{parsed.scenes.length !== 1 ? 's' : ''} Found
            </Text>
            {parsed.scenes.map((scene, si) => (
              <Card key={si} style={{ marginHorizontal: 16, marginBottom: 8 }}>
                <Card.Content>
                  <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                    Scene {scene.sceneNumber}
                  </Text>
                  <Text variant="titleSmall">{scene.title}</Text>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {scene.lines.length} lines
                  </Text>
                </Card.Content>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>

      {parsed && (
        <Surface style={[styles.footer, { backgroundColor: theme.colors.surface }]} elevation={4}>
          <Button onPress={() => { setParsed(null); setCharacterNames([]); }} style={{ flex: 1 }}>
            Re-import
          </Button>
          <Button
            mode="contained"
            onPress={handleSave}
            loading={isSaving}
            disabled={isSaving}
            style={{ flex: 1 }}
          >
            Save to Project
          </Button>
        </Surface>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  pickArea: { flex: 1, padding: 32, alignItems: 'center', justifyContent: 'center', minHeight: 300 },
  reviewArea: { paddingTop: 16 },
  section: { margin: 16, padding: 16, borderRadius: 12 },
  charRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  footer: { flexDirection: 'row', padding: 16, gap: 12 },
});
