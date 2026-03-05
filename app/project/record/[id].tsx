/**
 * Record Voices Screen
 *
 * One master recording track per scene. Hold a character chip to record a clip;
 * each clip is appended to the shared timeline in the order recorded. Clips are
 * coloured by character. The track can be played through in full, or individual
 * clips can be selected (tap) and deleted or repositioned via drag-and-drop.
 *
 * Track data is persisted as a JSON file at:
 *   documentDirectory/tracks/scene_<sceneId>.json
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  Text,
  useTheme,
  ActivityIndicator,
  IconButton,
  Surface,
  Chip,
} from 'react-native-paper';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { useProjectStore } from '@/stores/projectStore';
import { useSceneStore } from '@/stores/sceneStore';
import { generateId } from '@/db/repositories/utils';
import type { Character, TrackClip } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const WAVEFORM_BARS = 40;
const FLAT_AMPLITUDES: number[] = Array(WAVEFORM_BARS).fill(0.05);
const WIDTH_PER_SECOND = 60;   // px per second of audio
const MIN_CLIP_WIDTH = 56;     // px — minimum block width
const MIN_RECORDING_MS = 300;  // discard accidental taps shorter than this
const STOP_TAIL_MS = 400;      // extra ms recorded after button release

const RECORDING_OPTIONS: Audio.RecordingOptions = {
  ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
};

// ─── Track persistence ────────────────────────────────────────────────────────

function tracksDir() {
  return (FileSystem.documentDirectory ?? '') + 'tracks/';
}

function trackPath(sceneId: string) {
  return tracksDir() + `scene_${sceneId}.json`;
}

async function loadTrackClips(sceneId: string): Promise<TrackClip[]> {
  try {
    const info = await FileSystem.getInfoAsync(trackPath(sceneId));
    if (!info.exists) return [];
    const json = await FileSystem.readAsStringAsync(trackPath(sceneId));
    return JSON.parse(json) as TrackClip[];
  } catch {
    return [];
  }
}

async function saveTrackClips(sceneId: string, clips: TrackClip[]): Promise<void> {
  await FileSystem.makeDirectoryAsync(tracksDir(), { intermediates: true });
  await FileSystem.writeAsStringAsync(trackPath(sceneId), JSON.stringify(clips));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function recordingsDir() {
  return (FileSystem.documentDirectory ?? '') + 'recordings/';
}

function normalizeMetering(m: number | null | undefined): number {
  return Math.min(1, Math.max(0.02, ((m ?? -60) + 60) / 60));
}

function clipWidth(clip: TrackClip): number {
  return Math.max(MIN_CLIP_WIDTH, (clip.durationMs / 1000) * WIDTH_PER_SECOND);
}

function formatDuration(ms: number): string {
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

// ─── Waveform ─────────────────────────────────────────────────────────────────

function Waveform({ amplitudes, color }: { amplitudes: number[]; color: string }) {
  return (
    <View style={styles.waveform}>
      {amplitudes.map((amp, i) => (
        <View
          key={i}
          style={[styles.waveBar, { height: Math.max(3, amp * 36), backgroundColor: color }]}
        />
      ))}
    </View>
  );
}

// ─── Draggable Clip Block ─────────────────────────────────────────────────────

function ClipBlock({
  clip,
  isSelected,
  isPlaying,
  onTap,
  onDragEnd,
  onLayout,
  anyDragActive,
  setAnyDragActive,
}: {
  clip: TrackClip;
  isSelected: boolean;
  isPlaying: boolean;
  onTap: () => void;
  onDragEnd: (clipId: string, translationX: number) => void;
  onLayout: (clipId: string, width: number) => void;
  anyDragActive: SharedValue<boolean>;
  setAnyDragActive: (v: boolean) => void;
})
 {
  const theme = useTheme();
  const dragX = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse while playing
  useEffect(() => {
    if (isPlaying) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.45, duration: 450, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: 450, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [isPlaying, pulseAnim]);

  const commitDrag = useCallback(
    (tx: number) => {
      onDragEnd(clip.id, tx);
      setAnyDragActive(false);
    },
    [clip.id, onDragEnd, setAnyDragActive]
  );

  const panGesture = Gesture.Pan()
    .activateAfterLongPress(280)
    .onStart(() => {
      isDragging.value = true;
      anyDragActive.value = true;
      runOnJS(setAnyDragActive)(true);
    })
    .onUpdate((e) => {
      dragX.value = e.translationX;
    })
    .onEnd(() => {
      const tx = dragX.value;
      isDragging.value = false;
      dragX.value = withSpring(0, { damping: 20 });
      runOnJS(commitDrag)(tx);
    })
    .onFinalize(() => {
      if (isDragging.value) {
        isDragging.value = false;
        dragX.value = withSpring(0, { damping: 20 });
        anyDragActive.value = false;
        runOnJS(setAnyDragActive)(false);
      }
    });

  const reanimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }],
    zIndex: isDragging.value ? 100 : 1,
    elevation: isDragging.value ? 14 : isSelected ? 4 : 1,
    shadowOpacity: isDragging.value ? 0.3 : 0,
    opacity: isDragging.value ? 0.88 : 1,
  }));

  const w = clipWidth(clip);
  const bgColor = clip.characterColor + 'B3'; // 70% opacity

  return (
    <GestureDetector gesture={panGesture}>
      <Reanimated.View style={[reanimatedStyle, { marginRight: 6 }]}>
        <Animated.View style={{ opacity: pulseAnim }}>
          <Pressable
            onPress={onTap}
            onLayout={(e: LayoutChangeEvent) => onLayout(clip.id, e.nativeEvent.layout.width)}
            style={[
              styles.clipBlock,
              {
                width: w,
                backgroundColor: bgColor,
                borderColor: isSelected ? clip.characterColor : 'transparent',
                borderWidth: isSelected ? 2 : 0,
              },
            ]}
          >
            <Text
              style={[styles.clipCharName, { color: theme.colors.onSurface }]}
              numberOfLines={1}
            >
              {clip.characterName}
            </Text>
            {clip.transcript ? (
              <Text
                style={[styles.clipTranscript, { color: theme.colors.onSurface }]}
                numberOfLines={2}
              >
                {clip.transcript}
              </Text>
            ) : (
              <Text style={[styles.clipDuration, { color: theme.colors.onSurface }]}>
                {formatDuration(clip.durationMs)}
              </Text>
            )}
            {isPlaying && (
              <View style={[styles.playingDot, { backgroundColor: clip.characterColor }]} />
            )}
          </Pressable>
        </Animated.View>
      </Reanimated.View>
    </GestureDetector>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function RecordVoicesScreen() {
  const theme = useTheme();
  const { id: sceneId } = useLocalSearchParams<{ id: string }>();

  const { currentScene, lines, loadScene, isLoading: sceneLoading } = useSceneStore();
  const { currentProject, characters, loadProject } = useProjectStore();

  // Master track state
  const [clips, setClips] = useState<TrackClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingCharId, setRecordingCharId] = useState<string | null>(null);
  const [liveAmplitudes, setLiveAmplitudes] = useState<number[]>([...FLAT_AMPLITUDES]);

  // Playback state
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);
  const [isPlayingAll, setIsPlayingAll] = useState(false);

  // Drag state
  const [dragActive, setDragActive] = useState(false);
  const anyDragActive = useSharedValue(false);

  // Refs
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const pressStartRef = useRef(0);
  const cancelPlaybackRef = useRef(false);
  const blockWidthsRef = useRef<Record<string, number>>({});
  const stopDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRef = useRef('');
  const recordingCharRef = useRef<Character | null>(null);

  // ── Load ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (sceneId) loadScene(sceneId);
  }, [sceneId]);

  useEffect(() => {
    if (currentScene && (!currentProject || currentProject.id !== currentScene.projectId)) {
      loadProject(currentScene.projectId);
    }
  }, [currentScene]);

  useEffect(() => {
    if (currentScene) {
      loadTrackClips(currentScene.id).then(setClips);
    }
  }, [currentScene?.id]);

  // ── Speech recognition events ─────────────────────────────────────────────────

  useSpeechRecognitionEvent('result', (e) => {
    const text = e.results[0]?.transcript ?? '';
    if (text) transcriptRef.current = text;
  });

  // ── Cleanup ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (stopDelayRef.current) clearTimeout(stopDelayRef.current);
      cancelPlaybackRef.current = true;
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
      soundRef.current?.unloadAsync().catch(() => {});
      ExpoSpeechRecognitionModule.abort();
      Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
    };
  }, []);

  // ── Characters (scene-filtered, fall back to all) ────────────────────────────

  const sceneCharacterIds = new Set(
    lines.filter((l) => !l.isStageDirection).map((l) => l.characterId)
  );
  const sceneCharacters =
    sceneCharacterIds.size === 0
      ? characters
      : characters.filter((c) => sceneCharacterIds.has(c.id));

  // ── Permission ───────────────────────────────────────────────────────────────

  const ensureMicPermission = useCallback(async (): Promise<boolean> => {
    const { status } = await Audio.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Microphone Required',
        'To record character voices, allow microphone access in your device settings.'
      );
      return false;
    }
    return true;
  }, []);

  // ── Record ───────────────────────────────────────────────────────────────────

  const handleRecordStart = useCallback(
    async (char: Character) => {
      // Cancel any pending stop from a previous release
      if (stopDelayRef.current) {
        clearTimeout(stopDelayRef.current);
        stopDelayRef.current = null;
      }

      pressStartRef.current = Date.now();
      recordingCharRef.current = char;

      const permitted = await ensureMicPermission();
      if (!permitted) return;

      // Stop any active playback
      cancelPlaybackRef.current = true;
      await soundRef.current?.stopAsync().catch(() => {});
      await soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
      setPlayingClipId(null);
      setIsPlayingAll(false);

      await FileSystem.makeDirectoryAsync(recordingsDir(), { intermediates: true });
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true });

      // Start speech recognition in parallel (best-effort — transcript may be empty)
      transcriptRef.current = '';
      try {
        await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        ExpoSpeechRecognitionModule.start({
          lang: char.voiceSettings.language ?? 'en-US',
          interimResults: true,
          continuous: true,
          requiresOnDeviceRecognition: false,
        });
      } catch {
        // STT unavailable — audio recording still proceeds
      }

      try {
        const rec = new Audio.Recording();
        await rec.prepareToRecordAsync(RECORDING_OPTIONS);
        rec.setOnRecordingStatusUpdate((status) => {
          if (status.isRecording && status.metering !== undefined) {
            const amp = normalizeMetering(status.metering);
            setLiveAmplitudes((prev) => [...prev.slice(-(WAVEFORM_BARS - 1)), amp]);
          }
        });
        await rec.startAsync();
        recordingRef.current = rec;
        setIsRecording(true);
        setRecordingCharId(char.id);
        setLiveAmplitudes([...FLAT_AMPLITUDES]);
      } catch (err) {
        ExpoSpeechRecognitionModule.abort();
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
        Alert.alert('Recording Error', String(err));
      }
    },
    [ensureMicPermission]
  );

  const handleRecordStop = useCallback(
    (char: Character) => {
      // Schedule actual stop after tail to avoid abrupt cutoff
      if (stopDelayRef.current) clearTimeout(stopDelayRef.current);
      stopDelayRef.current = setTimeout(async () => {
        stopDelayRef.current = null;

        const pressDuration = Date.now() - pressStartRef.current;
        const rec = recordingRef.current;
        if (!rec) return;

        recordingRef.current = null;
        setIsRecording(false);
        setRecordingCharId(null);
        setLiveAmplitudes([...FLAT_AMPLITUDES]);

        // Stop STT and wait briefly for the final result to arrive
        try { ExpoSpeechRecognitionModule.stop(); } catch { /* ignore */ }
        await new Promise<void>((r) => setTimeout(r, 250));
        const transcript = transcriptRef.current;

        if (pressDuration < MIN_RECORDING_MS) {
          await rec.stopAndUnloadAsync().catch(() => {});
          await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
          return;
        }

        try {
          const statusBefore = await rec.getStatusAsync();
          const durationMs = statusBefore.durationMillis ?? 0;
          await rec.stopAndUnloadAsync();
          await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

          const tempUri = rec.getURI();
          if (!tempUri || !currentScene) return;

          const dest = recordingsDir() + `${char.id}_${Date.now()}.m4a`;
          await FileSystem.copyAsync({ from: tempUri, to: dest });

          const newClip: TrackClip = {
            id: generateId(),
            characterId: char.id,
            characterName: char.name,
            characterColor: char.color,
            uri: dest,
            durationMs,
            transcript: transcript || undefined,
          };

          setClips((prev) => {
            const next = [...prev, newClip];
            saveTrackClips(currentScene.id, next).catch(() => {});
            return next;
          });
        } catch (err) {
          await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
          Alert.alert('Save Error', String(err));
        }
      }, STOP_TAIL_MS);
    },
    [currentScene]
  );

  // ── Play All ─────────────────────────────────────────────────────────────────

  const handlePlayAll = useCallback(async () => {
    if (clips.length === 0) return;

    cancelPlaybackRef.current = false;
    setIsPlayingAll(true);
    setSelectedClipId(null);
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

    for (const clip of clips) {
      if (cancelPlaybackRef.current) break;

      setPlayingClipId(clip.id);
      try {
        const { sound } = await Audio.Sound.createAsync(
          { uri: clip.uri },
          { shouldPlay: true }
        );
        soundRef.current = sound;

        await new Promise<void>((resolve) => {
          sound.setOnPlaybackStatusUpdate((ps) => {
            if (!ps.isLoaded) { resolve(); return; }
            if (ps.didJustFinish || cancelPlaybackRef.current) {
              sound.unloadAsync().catch(() => {});
              resolve();
            }
          });
        });
        soundRef.current = null;
      } catch {
        // Skip clip on error
      }
    }

    setPlayingClipId(null);
    setIsPlayingAll(false);
  }, [clips]);

  const handleStopPlayback = useCallback(async () => {
    cancelPlaybackRef.current = true;
    await soundRef.current?.stopAsync().catch(() => {});
    await soundRef.current?.unloadAsync().catch(() => {});
    soundRef.current = null;
    setPlayingClipId(null);
    setIsPlayingAll(false);
  }, []);

  // ── Delete selected clip ─────────────────────────────────────────────────────

  const handleDeleteSelected = useCallback(async () => {
    if (!selectedClipId || !currentScene) return;

    const clip = clips.find((c) => c.id === selectedClipId);
    if (clip) {
      await FileSystem.deleteAsync(clip.uri, { idempotent: true }).catch(() => {});
    }

    setClips((prev) => {
      const next = prev.filter((c) => c.id !== selectedClipId);
      saveTrackClips(currentScene.id, next).catch(() => {});
      return next;
    });
    setSelectedClipId(null);
  }, [selectedClipId, clips, currentScene]);

  // ── Drag-to-reorder ─────────────────────────────────────────────────────────

  const handleDragEnd = useCallback(
    async (clipId: string, translationX: number) => {
      if (!currentScene || clips.length < 2) return;

      const fromIndex = clips.findIndex((c) => c.id === clipId);
      if (fromIndex === -1) return;

      // Compute where the dragged clip's center lands
      const widths = clips.map((c) => (blockWidthsRef.current[c.id] ?? clipWidth(c)) + 6);
      let startX = 0;
      for (let i = 0; i < fromIndex; i++) startX += widths[i];
      const draggedCenter = startX + widths[fromIndex] / 2 + translationX;

      let toIndex = clips.length - 1;
      let cumX = 0;
      for (let i = 0; i < clips.length; i++) {
        if (draggedCenter < cumX + widths[i] / 2) { toIndex = i; break; }
        cumX += widths[i];
      }

      if (fromIndex === toIndex) return;

      const next = [...clips];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);

      setClips(next);
      await saveTrackClips(currentScene.id, next).catch(() => {});
    },
    [clips, currentScene]
  );

  const handleBlockLayout = useCallback((clipId: string, width: number) => {
    blockWidthsRef.current[clipId] = width;
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────────

  if (sceneLoading || !currentScene) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  const recordingChar = characters.find((c) => c.id === recordingCharId);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={['bottom']}
    >
      {/* ── Character chips — hold to record ── */}
      <Surface style={[styles.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
        <Text
          variant="labelMedium"
          style={{ color: theme.colors.onSurfaceVariant, marginBottom: 10 }}
        >
          Hold a character to record
        </Text>
        {sceneCharacters.length === 0 ? (
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            No characters found. Add characters from the scene screen.
          </Text>
        ) : (
          <View style={styles.chipGrid}>
            {sceneCharacters.map((char) => {
              const active = recordingCharId === char.id;
              return (
                <Pressable
                  key={char.id}
                  onPressIn={() => handleRecordStart(char)}
                  onPressOut={() => handleRecordStop(char)}
                  style={[
                    styles.charButton,
                    {
                      backgroundColor: active ? char.color : char.color + '33',
                      borderColor: char.color,
                      borderWidth: active ? 2 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.charButtonIcon, { color: active ? '#fff' : char.color }]}>
                    {active ? '⏺' : '●'}
                  </Text>
                  <Text
                    style={[styles.charButtonLabel, { color: active ? '#fff' : char.color }]}
                    numberOfLines={2}
                  >
                    {char.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Live waveform */}
        {isRecording && recordingChar && (
          <View style={styles.waveformRow}>
            <View style={[styles.recDot, { backgroundColor: '#EF4444' }]} />
            <Waveform amplitudes={liveAmplitudes} color={recordingChar.color} />
            <Text variant="labelSmall" style={{ color: '#EF4444', marginLeft: 6 }}>
              Release to stop
            </Text>
          </View>
        )}
      </Surface>

      {/* ── Master track ── */}
      <Surface style={[styles.section, { backgroundColor: theme.colors.surface, flex: 1 }]} elevation={1}>
        {/* Track header */}
        <View style={styles.trackHeader}>
          <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant, flex: 1 }}>
            Scene Track  {clips.length > 0 && `· ${clips.length} clip${clips.length !== 1 ? 's' : ''}`}
          </Text>
          {isPlayingAll ? (
            <IconButton
              icon="stop-circle"
              iconColor={theme.colors.error}
              size={28}
              onPress={handleStopPlayback}
              style={styles.playBtn}
            />
          ) : (
            <IconButton
              icon="play-circle"
              iconColor={clips.length > 0 ? theme.colors.primary : theme.colors.onSurfaceDisabled}
              size={28}
              onPress={handlePlayAll}
              disabled={clips.length === 0}
              style={styles.playBtn}
            />
          )}
        </View>

        {/* Clip track */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEnabled={!dragActive}
          style={styles.trackScroll}
          contentContainerStyle={styles.trackContent}
        >
          {clips.length === 0 ? (
            <View style={[styles.emptyTrack, { borderColor: theme.colors.outline }]}>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                No clips yet — hold a character above to record
              </Text>
            </View>
          ) : (
            clips.map((clip) => (
              <ClipBlock
                key={clip.id}
                clip={clip}
                isSelected={selectedClipId === clip.id}
                isPlaying={playingClipId === clip.id}
                onTap={() =>
                  setSelectedClipId((prev) => (prev === clip.id ? null : clip.id))
                }
                onDragEnd={handleDragEnd}
                onLayout={handleBlockLayout}
                anyDragActive={anyDragActive}
                setAnyDragActive={setDragActive}
              />
            ))
          )}
        </ScrollView>

        {/* Selected clip actions */}
        {selectedClipId && (
          <View style={[styles.actionRow, { borderTopColor: theme.colors.outline }]}>
            <Text
              variant="labelMedium"
              style={{ color: theme.colors.onSurfaceVariant, flex: 1 }}
            >
              {clips.find((c) => c.id === selectedClipId)?.characterName ?? ''}
              {' · '}
              {formatDuration(clips.find((c) => c.id === selectedClipId)?.durationMs ?? 0)}
            </Text>
            <IconButton
              icon="delete"
              iconColor={theme.colors.error}
              size={22}
              onPress={handleDeleteSelected}
            />
          </View>
        )}
      </Surface>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, gap: 8, padding: 12 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  section: { borderRadius: 12, padding: 12 },

  // Character buttons
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  charButton: {
    width: '30%',
    flexGrow: 1,
    minWidth: 90,
    paddingVertical: 18,
    paddingHorizontal: 10,
    borderRadius: 14,
    alignItems: 'center',
    gap: 6,
  },
  charButtonIcon: { fontSize: 22 },
  charButtonLabel: { fontWeight: '700', fontSize: 15, textAlign: 'center' },

  // Waveform
  waveformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 4,
  },
  waveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 40,
    gap: 2,
  },
  waveBar: { width: 4, borderRadius: 2 },
  recDot: { width: 8, height: 8, borderRadius: 4 },

  // Track
  trackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  playBtn: { margin: 0 },
  trackScroll: { flexGrow: 0 },
  trackContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    minHeight: 64,
  },
  emptyTrack: {
    height: 48,
    minWidth: 260,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },

  // Clip block
  clipBlock: {
    height: 72,
    borderRadius: 8,
    padding: 7,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  clipCharName: {
    fontSize: 11,
    fontWeight: '700',
    opacity: 0.9,
  },
  clipTranscript: {
    fontSize: 10,
    opacity: 0.75,
    lineHeight: 13,
  },
  clipDuration: {
    fontSize: 11,
    opacity: 0.7,
  },
  playingDot: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },

  // Action row
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 6,
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
