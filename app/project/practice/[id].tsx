import { useEffect, useRef, useState, useCallback } from 'react';
import { Animated, ScrollView, View, StyleSheet, Pressable } from 'react-native';
import { Text, IconButton, useTheme, Modal, Portal, Switch } from 'react-native-paper';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { useProjectStore } from '@/stores/projectStore';
import { useSceneStore } from '@/stores/sceneStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { PracticeEngine } from '@/services/practiceEngine';
import { MuteOverlay } from '@/components/MuteOverlay';
import { useNowPlaying } from '@/hooks/useNowPlaying';
import type { PracticeLineItem, PracticeState, Character, TrackClip } from '@/types';

// ─── Track helpers (mirrors record screen) ────────────────────────────────────

const TRACK_WIDTH_PER_SEC = 60;
const TRACK_MIN_WIDTH = 56;
const TRACK_GAP = 6;

function trackClipW(clip: TrackClip) {
  return Math.max(TRACK_MIN_WIDTH, (clip.durationMs / 1000) * TRACK_WIDTH_PER_SEC);
}

function fmtDuration(ms: number) {
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

async function loadTrackClips(sceneId: string): Promise<TrackClip[]> {
  try {
    const path = `${FileSystem.documentDirectory ?? ''}tracks/scene_${sceneId}.json`;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return [];
    const json = await FileSystem.readAsStringAsync(path);
    return JSON.parse(json) as TrackClip[];
  } catch {
    return [];
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PracticeScreen() {
  const theme = useTheme();
  const { id: sceneId } = useLocalSearchParams<{ id: string }>();
  const { characters, currentProject, updateCharacter } = useProjectStore();
  const { currentScene, lines, loadScene } = useSceneStore();
  const { promptLevel, playbackSpeed } = useSettingsStore();

  // ── Shared state ─────────────────────────────────────────────────────────────
  const [mutedCharIds, setMutedCharIds] = useState<Set<string>>(new Set());
  const [bufferEditChar, setBufferEditChar] = useState<Character | null>(null);
  const [editPre, setEditPre] = useState(0);
  const [editPost, setEditPost] = useState(0);

  // ── Track mode state ─────────────────────────────────────────────────────────
  const [trackClips, setTrackClips] = useState<TrackClip[]>([]);
  const [trackMode, setTrackMode] = useState(false);
  const [trackPlaying, setTrackPlaying] = useState(false);
  const [trackCurrentIdx, setTrackCurrentIdx] = useState(-1);
  const playheadAnim = useRef(new Animated.Value(0)).current;
  const playheadAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const trackSoundRef = useRef<Audio.Sound | null>(null);
  const trackCancelRef = useRef(false);

  // ── TTS mode state ───────────────────────────────────────────────────────────
  const engineRef = useRef<PracticeEngine | null>(null);
  const [practiceState, setPracticeState] = useState<PracticeState>('idle');
  const [currentItem, setCurrentItem] = useState<PracticeLineItem | null>(null);
  const [previousItem, setPreviousItem] = useState<PracticeLineItem | null>(null);
  const [nextItem, setNextItem] = useState<PracticeLineItem | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  useNowPlaying({
    title: currentScene?.title ?? 'Practice',
    artist: currentItem?.character?.name ?? '',
    album: currentProject?.title ?? 'Actors Offbook',
    lineIndex: progress.current,
    totalLines: progress.total,
  });

  // ── Init: detect track vs TTS mode ───────────────────────────────────────────
  useEffect(() => {
    if (!sceneId) return;
    loadTrackClips(sceneId).then((clips) => {
      if (clips.length > 0) {
        setTrackClips(clips);
        setTrackMode(true);
      }
    });
  }, [sceneId]);

  // ── Init: default mute actor characters ──────────────────────────────────────
  useEffect(() => {
    const actorIds = characters.filter((c) => c.isActor).map((c) => c.id);
    setMutedCharIds(new Set(actorIds));
  }, [characters]);

  // ── Load scene data (for TTS mode) ───────────────────────────────────────────
  useEffect(() => {
    if (sceneId) loadScene(sceneId);
  }, [sceneId]);

  // ── Build TTS engine once loaded (TTS mode only) ──────────────────────────────
  useEffect(() => {
    if (trackMode || !lines.length || !characters.length) return;

    const engine = new PracticeEngine();
    engineRef.current = engine;
    engine.load(lines, characters, mutedCharIds);

    const unsub = engine.on((event) => {
      if (event.type === 'state_change') setPracticeState(event.state);
      if (event.type === 'line_start') {
        setPreviousItem(currentItem);
        setCurrentItem(event.item);
        const nextQueue = (engine as any).queue as PracticeLineItem[];
        setNextItem(nextQueue[event.index + 1] ?? null);
      }
      if (event.type === 'progress') setProgress({ current: event.current, total: event.total });
    });

    return () => { unsub(); engine.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, characters, trackMode]);

  // ── Cleanup track resources on unmount ───────────────────────────────────────
  useEffect(() => {
    return () => {
      trackCancelRef.current = true;
      trackSoundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  // ── Mute toggle ──────────────────────────────────────────────────────────────
  const toggleMute = useCallback((charId: string) => {
    setMutedCharIds((prev) => {
      const next = new Set(prev);
      if (next.has(charId)) { next.delete(charId); } else { next.add(charId); }
      // Rebuild TTS engine if in TTS mode
      const engine = engineRef.current;
      if (engine && !trackMode) {
        engine.pause();
        engine.load(lines, characters, next);
      }
      return next;
    });
  }, [lines, characters, trackMode]);

  // ── Track playback ────────────────────────────────────────────────────────────
  const handleTrackPlay = useCallback(async () => {
    if (trackClips.length === 0 || trackPlaying) return;
    trackCancelRef.current = false;
    setTrackPlaying(true);
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

    let cumX = 0;
    for (let i = 0; i < trackClips.length; i++) {
      if (trackCancelRef.current) break;

      const clip = trackClips[i];
      const clipW = trackClipW(clip);
      const isMuted = mutedCharIds.has(clip.characterId);
      const char = characters.find((c) => c.id === clip.characterId);
      const preMs = char?.voiceSettings.mutePreBufferMs ?? 0;
      const postMs = char?.voiceSettings.mutePostBufferMs ?? 0;

      setTrackCurrentIdx(i);

      // Pre-buffer: playhead stays still
      if (preMs > 0 && !trackCancelRef.current) {
        await new Promise<void>((resolve) => setTimeout(resolve, preMs));
      }
      if (trackCancelRef.current) break;

      // Animate playhead across this clip's width
      const anim = Animated.timing(playheadAnim, {
        toValue: cumX + clipW,
        duration: clip.durationMs,
        useNativeDriver: true,
      });
      playheadAnimRef.current = anim;

      if (isMuted) {
        // Skip audio — just wait + animate
        anim.start();
        await new Promise<void>((resolve) => setTimeout(resolve, clip.durationMs));
      } else {
        try {
          const { sound } = await Audio.Sound.createAsync(
            { uri: clip.uri },
            { shouldPlay: true }
          );
          trackSoundRef.current = sound;
          anim.start();
          await new Promise<void>((resolve) => {
            sound.setOnPlaybackStatusUpdate((ps) => {
              if (!ps.isLoaded || ps.didJustFinish || trackCancelRef.current) {
                sound.unloadAsync().catch(() => {});
                resolve();
              }
            });
          });
          trackSoundRef.current = null;
        } catch {
          anim.start();
          await new Promise<void>((resolve) => setTimeout(resolve, clip.durationMs));
        }
      }

      // Post-buffer: playhead stays still
      if (postMs > 0 && !trackCancelRef.current) {
        await new Promise<void>((resolve) => setTimeout(resolve, postMs));
      }

      cumX += clipW + TRACK_GAP;
    }

    setTrackPlaying(false);
    setTrackCurrentIdx(-1);
  }, [trackClips, mutedCharIds, characters, playheadAnim, trackPlaying]);

  const handleTrackStop = useCallback(async () => {
    trackCancelRef.current = true;
    playheadAnimRef.current?.stop();
    await trackSoundRef.current?.stopAsync().catch(() => {});
    await trackSoundRef.current?.unloadAsync().catch(() => {});
    trackSoundRef.current = null;
    setTrackPlaying(false);
    setTrackCurrentIdx(-1);
    Animated.timing(playheadAnim, { toValue: 0, duration: 250, useNativeDriver: true }).start();
  }, [playheadAnim]);

  const handleTrackRestart = useCallback(async () => {
    await handleTrackStop();
  }, [handleTrackStop]);

  // ── TTS controls ─────────────────────────────────────────────────────────────
  const handlePlayPause = () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (practiceState === 'playing' || practiceState === 'muted_waiting') {
      engine.pause();
    } else {
      engine.play();
    }
  };
  const handleSkip = () => engineRef.current?.skipLine();
  const handlePrevious = () => engineRef.current?.previousLine();
  const handleRestart = () => {
    engineRef.current?.restart();
    setCurrentItem(null); setPreviousItem(null); setNextItem(null);
    setProgress({ current: 0, total: lines.length });
  };

  const isPlaying = practiceState === 'playing' || practiceState === 'muted_waiting';
  const isMuted = currentItem?.isMuted ?? false;
  const progressPercent = progress.total > 0 ? progress.current / progress.total : 0;

  // ── Character chip + buffer modal (shared) ────────────────────────────────────
  const charChips = (
    <View style={styles.charToggles}>
      {characters.map((char) => (
        <Pressable
          key={char.id}
          onPress={() => toggleMute(char.id)}
          onLongPress={() => {
            setEditPre((char.voiceSettings.mutePreBufferMs ?? 0) / 1000);
            setEditPost((char.voiceSettings.mutePostBufferMs ?? 0) / 1000);
            setBufferEditChar(char);
          }}
        >
          <View
            style={[
              styles.charToggle,
              {
                backgroundColor: mutedCharIds.has(char.id) ? char.color + '33' : '#222',
                borderColor: char.color,
              },
            ]}
          >
            <Text
              variant="labelSmall"
              style={{ color: mutedCharIds.has(char.id) ? char.color : '#999' }}
              numberOfLines={1}
            >
              {char.name}
            </Text>
            <Text style={{ color: mutedCharIds.has(char.id) ? char.color : '#555' }}>
              {mutedCharIds.has(char.id) ? ' ●' : ' ○'}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: '#0a0a1a' }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>

        {/* Header */}
        <View style={styles.header}>
          <IconButton
            icon="chevron-left"
            iconColor="#fff"
            size={28}
            onPress={() => {
              engineRef.current?.destroy();
              handleTrackStop();
              router.back();
            }}
          />
          <Text variant="titleMedium" style={styles.headerTitle} numberOfLines={1}>
            {currentScene?.title ?? 'Practice'}
          </Text>
          <IconButton
            icon="refresh"
            iconColor="#fff"
            size={24}
            onPress={trackMode ? handleTrackRestart : handleRestart}
          />
        </View>

        {trackMode ? (
          /* ══ TRACK MODE ══════════════════════════════════════════════════════ */
          <View style={{ flex: 1 }}>
            {/* Current clip info */}
            <View style={styles.trackNowPlaying}>
              {trackCurrentIdx >= 0 ? (
                <>
                  <View
                    style={[
                      styles.trackNowDot,
                      { backgroundColor: trackClips[trackCurrentIdx].characterColor },
                    ]}
                  />
                  <Text
                    style={[
                      styles.trackNowName,
                      { color: trackClips[trackCurrentIdx].characterColor },
                    ]}
                  >
                    {trackClips[trackCurrentIdx].characterName}
                  </Text>
                  {mutedCharIds.has(trackClips[trackCurrentIdx].characterId) && (
                    <Text style={styles.trackNowMuted}> — YOUR TURN</Text>
                  )}
                  <Text style={styles.trackNowDuration}>
                    {' '}· {fmtDuration(trackClips[trackCurrentIdx].durationMs)}
                  </Text>
                </>
              ) : (
                <Text style={styles.trackIdleHint}>
                  {trackPlaying ? '' : 'Tap ▶ to start · Long-press a chip to set buffer'}
                </Text>
              )}
            </View>

            {/* Track timeline + playhead */}
            <View style={styles.trackArea}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.trackScroll}
                contentContainerStyle={styles.trackContent}
              >
                {/* Clip blocks */}
                {trackClips.map((clip, i) => {
                  const w = trackClipW(clip);
                  const isMutedClip = mutedCharIds.has(clip.characterId);
                  const isCurrent = i === trackCurrentIdx;
                  return (
                    <View
                      key={clip.id}
                      style={[
                        styles.trackClipBlock,
                        {
                          width: w,
                          backgroundColor: isMutedClip
                            ? '#2a2a3a'
                            : clip.characterColor + 'B3',
                          borderColor: isCurrent ? clip.characterColor : 'transparent',
                          borderWidth: isCurrent ? 2 : 0,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.trackClipName,
                          { color: isMutedClip ? '#666' : '#fff' },
                        ]}
                        numberOfLines={1}
                      >
                        {clip.characterName}
                      </Text>
                      {clip.transcript ? (
                        <Text
                          style={[
                            styles.trackClipTranscript,
                            { color: isMutedClip ? '#555' : '#ffffffcc' },
                          ]}
                          numberOfLines={2}
                        >
                          {clip.transcript}
                        </Text>
                      ) : (
                        <Text
                          style={[
                            styles.trackClipDur,
                            { color: isMutedClip ? '#555' : '#ffffffaa' },
                          ]}
                        >
                          {isMutedClip ? '●' : fmtDuration(clip.durationMs)}
                        </Text>
                      )}
                    </View>
                  );
                })}

                {/* Playhead */}
                <Animated.View
                  style={[
                    styles.playhead,
                    { transform: [{ translateX: playheadAnim }] },
                  ]}
                />
              </ScrollView>
            </View>

            {/* Controls */}
            <View style={styles.trackControls}>
              {trackPlaying ? (
                <IconButton
                  icon="stop-circle"
                  iconColor="#EF4444"
                  size={56}
                  onPress={handleTrackStop}
                  style={styles.trackPlayBtn}
                />
              ) : (
                <IconButton
                  icon="play-circle"
                  iconColor="#6366F1"
                  size={56}
                  onPress={handleTrackPlay}
                  disabled={trackClips.length === 0}
                  style={styles.trackPlayBtn}
                />
              )}
            </View>

            {/* Character mute chips */}
            <View style={styles.trackChipArea}>
              <Text variant="labelSmall" style={styles.trackChipHint}>
                Tap to mute · Long-press for buffer
              </Text>
              {charChips}
            </View>
          </View>

        ) : (
          /* ══ TTS MODE ════════════════════════════════════════════════════════ */
          <>
            {practiceState === 'complete' ? (
              <View style={styles.completeArea}>
                <Text variant="displaySmall" style={{ color: '#10B981', textAlign: 'center' }}>
                  Scene Complete!
                </Text>
                <Text variant="bodyLarge" style={{ color: '#fff', textAlign: 'center', marginTop: 12 }}>
                  {progress.total} lines practiced
                </Text>
                <View style={styles.completeButtons}>
                  <IconButton icon="refresh" iconColor="#fff" size={40} onPress={handleRestart} />
                  <IconButton icon="check" iconColor="#10B981" size={40} onPress={() => router.back()} />
                </View>
              </View>
            ) : (
              <>
                <View style={styles.linesArea}>
                  {previousItem && !previousItem.line.isStageDirection && (
                    <Text variant="bodyMedium" style={styles.previousLine} numberOfLines={2}>
                      {previousItem.line.text}
                    </Text>
                  )}
                  <View style={styles.currentLineArea}>
                    {currentItem ? (
                      isMuted ? (
                        <MuteOverlay item={currentItem} promptLevel={promptLevel} />
                      ) : currentItem.line.isStageDirection ? (
                        <Text variant="bodyMedium" style={styles.stageDirection} numberOfLines={3}>
                          {currentItem.line.text}
                        </Text>
                      ) : (
                        <View style={{ alignItems: 'center' }}>
                          <Text
                            variant="labelLarge"
                            style={[styles.currentCharName, { color: currentItem.character?.color ?? '#fff' }]}
                          >
                            {currentItem.character?.name ?? ''}
                          </Text>
                          <Text variant="headlineSmall" style={styles.currentLineText} numberOfLines={6}>
                            {currentItem.line.text}
                          </Text>
                        </View>
                      )
                    ) : (
                      <Pressable onPress={handlePlayPause} style={styles.startPrompt}>
                        <Text variant="headlineMedium" style={{ color: '#fff', textAlign: 'center' }}>
                          Tap ▶ to start
                        </Text>
                      </Pressable>
                    )}
                  </View>
                  {nextItem && !nextItem.line.isStageDirection && (
                    <Text variant="bodySmall" style={styles.nextLine} numberOfLines={1}>
                      {nextItem.character?.name}: {nextItem.line.text}
                    </Text>
                  )}
                </View>

                <View style={styles.controls}>
                  <View style={[styles.progressTrack, { backgroundColor: '#333' }]}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${progressPercent * 100}%`, backgroundColor: '#6366F1' },
                      ]}
                    />
                  </View>
                  <Text variant="labelSmall" style={styles.progressText}>
                    {progress.current} / {progress.total} lines
                  </Text>
                  <View style={styles.buttonRow}>
                    <IconButton icon="skip-previous" iconColor="#ccc" size={32} onPress={handlePrevious} />
                    <IconButton
                      icon={isPlaying ? 'pause' : 'play'}
                      iconColor="#fff"
                      size={48}
                      onPress={handlePlayPause}
                      style={[styles.playButton, { backgroundColor: '#6366F1' }]}
                    />
                    <IconButton icon="skip-next" iconColor="#ccc" size={32} onPress={handleSkip} />
                  </View>
                  {charChips}
                </View>
              </>
            )}
          </>
        )}

        {/* Buffer settings modal (shared) */}
        <Portal>
          <Modal
            visible={bufferEditChar !== null}
            onDismiss={() => setBufferEditChar(null)}
            contentContainerStyle={styles.bufferModal}
          >
            {bufferEditChar && (
              <>
                <Text
                  variant="titleMedium"
                  style={{ color: bufferEditChar.color, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 }}
                >
                  {bufferEditChar.name}
                </Text>

                <View style={styles.bufferRow}>
                  <Text variant="bodyMedium" style={{ color: '#fff', flex: 1 }}>Mute this character</Text>
                  <Switch
                    value={mutedCharIds.has(bufferEditChar.id)}
                    onValueChange={() => { toggleMute(bufferEditChar.id); setBufferEditChar(null); }}
                    color={bufferEditChar.color}
                  />
                </View>

                <View style={styles.bufferRow}>
                  <Text variant="bodyMedium" style={{ color: '#ccc', flex: 1 }}>Before line</Text>
                  <Pressable onPress={() => setEditPre((v) => Math.max(0, Math.round((v - 0.5) * 10) / 10))} style={styles.stepBtn}>
                    <Text style={styles.stepBtnText}>−</Text>
                  </Pressable>
                  <Text style={styles.stepValue}>{editPre.toFixed(1)} s</Text>
                  <Pressable onPress={() => setEditPre((v) => Math.min(5, Math.round((v + 0.5) * 10) / 10))} style={styles.stepBtn}>
                    <Text style={styles.stepBtnText}>+</Text>
                  </Pressable>
                </View>

                <View style={styles.bufferRow}>
                  <Text variant="bodyMedium" style={{ color: '#ccc', flex: 1 }}>After line</Text>
                  <Pressable onPress={() => setEditPost((v) => Math.max(0, Math.round((v - 0.5) * 10) / 10))} style={styles.stepBtn}>
                    <Text style={styles.stepBtnText}>−</Text>
                  </Pressable>
                  <Text style={styles.stepValue}>{editPost.toFixed(1)} s</Text>
                  <Pressable onPress={() => setEditPost((v) => Math.min(5, Math.round((v + 0.5) * 10) / 10))} style={styles.stepBtn}>
                    <Text style={styles.stepBtnText}>+</Text>
                  </Pressable>
                </View>

                <View style={styles.bufferButtons}>
                  <Pressable onPress={() => setBufferEditChar(null)} style={styles.cancelBtn}>
                    <Text style={{ color: '#999' }}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={async () => {
                      await updateCharacter(bufferEditChar.id, {
                        voiceSettings: {
                          ...bufferEditChar.voiceSettings,
                          mutePreBufferMs: Math.round(editPre * 1000),
                          mutePostBufferMs: Math.round(editPost * 1000),
                        },
                      });
                      setBufferEditChar(null);
                    }}
                    style={[styles.saveBtn, { backgroundColor: bufferEditChar.color }]}
                  >
                    <Text style={{ color: '#fff', fontWeight: '600' }}>Save</Text>
                  </Pressable>
                </View>
              </>
            )}
          </Modal>
        </Portal>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#333',
  },
  headerTitle: { flex: 1, color: '#fff', textAlign: 'center' },

  // ── Track mode ──────────────────────────────────────────────────────────────
  trackNowPlaying: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    minHeight: 56,
  },
  trackNowDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  trackNowName: { fontSize: 16, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  trackNowMuted: { color: '#10B981', fontWeight: '600', fontSize: 13 },
  trackNowDuration: { color: '#666', fontSize: 13 },
  trackIdleHint: { color: '#555', fontSize: 13 },

  trackArea: {
    flex: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#222',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222',
  },
  trackScroll: { flex: 1 },
  trackContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 20,
    position: 'relative',
  },
  trackClipBlock: {
    height: 72,
    borderRadius: 8,
    padding: 8,
    justifyContent: 'space-between',
    marginRight: TRACK_GAP,
    overflow: 'hidden',
  },
  trackClipName: { fontSize: 11, fontWeight: '700' },
  trackClipTranscript: { fontSize: 10, lineHeight: 13 },
  trackClipDur: { fontSize: 11 },
  playhead: {
    position: 'absolute',
    top: 12,
    bottom: 12,
    left: 16,
    width: 2,
    borderRadius: 1,
    backgroundColor: '#fff',
    opacity: 0.9,
  },

  trackControls: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  trackPlayBtn: { margin: 0 },

  trackChipArea: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#333',
    paddingTop: 12,
  },
  trackChipHint: { color: '#444', textAlign: 'center', marginBottom: 8 },

  // ── TTS mode ────────────────────────────────────────────────────────────────
  linesArea: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  previousLine: { color: '#555', textAlign: 'center', marginBottom: 16 },
  currentLineArea: { minHeight: 200, justifyContent: 'center', alignItems: 'center' },
  currentCharName: {
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    fontWeight: '700',
    marginBottom: 12,
  },
  currentLineText: { color: '#fff', textAlign: 'center', lineHeight: 36 },
  stageDirection: { color: '#888', fontStyle: 'italic', textAlign: 'center' },
  nextLine: { color: '#444', textAlign: 'center', marginTop: 16 },
  startPrompt: { padding: 32 },

  controls: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#333',
  },
  progressTrack: { height: 4, borderRadius: 2, marginVertical: 12, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2 },
  progressText: { color: '#666', textAlign: 'center', marginBottom: 8 },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  playButton: { borderRadius: 40 },

  // ── Shared ──────────────────────────────────────────────────────────────────
  charToggles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  charToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },

  completeArea: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  completeButtons: { flexDirection: 'row', marginTop: 32, gap: 24 },

  // ── Buffer modal ─────────────────────────────────────────────────────────────
  bufferModal: { backgroundColor: '#1a1a2e', margin: 24, padding: 24, borderRadius: 16 },
  bufferRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  stepBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#333', justifyContent: 'center', alignItems: 'center',
  },
  stepBtnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  stepValue: { color: '#fff', width: 52, textAlign: 'center', fontSize: 15 },
  bufferButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8 },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 10 },
  saveBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
});
