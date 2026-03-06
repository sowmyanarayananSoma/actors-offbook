import { useEffect, useRef, useState, useCallback } from 'react';
import { Alert, Animated, PanResponder, ScrollView, View, StyleSheet, Pressable, Dimensions } from 'react-native';
import { Text, IconButton, useTheme, Modal, Portal, Switch, ActivityIndicator } from 'react-native-paper';
import { WebView } from 'react-native-webview';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

// ffmpeg-kit-react-native — optional, requires a native dev build
let FFmpegKit: { execute: (cmd: string) => Promise<{ getReturnCode: () => Promise<{ isValueSuccess: () => boolean }> }> } | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  FFmpegKit = require('ffmpeg-kit-react-native').FFmpegKit;
} catch { /* not installed */ }
import { useProjectStore } from '@/stores/projectStore';
import { useSceneStore } from '@/stores/sceneStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { PracticeEngine } from '@/services/practiceEngine';
import { MuteOverlay } from '@/components/MuteOverlay';
import { useNowPlaying } from '@/hooks/useNowPlaying';
import type { PracticeLineItem, PracticeState, Character, TrackClip } from '@/types';

const SCREEN_HEIGHT = Dimensions.get('window').height;

async function loadDocUri(sceneId: string): Promise<string | null> {
  try {
    const path = `${FileSystem.documentDirectory ?? ''}docs/scene_${sceneId}.json`;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const json = await FileSystem.readAsStringAsync(path);
    return JSON.parse(json).uri ?? null;
  } catch { return null; }
}

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
  const [docUri, setDocUri] = useState<string | null>(null);
  const [showDoc, setShowDoc] = useState(true);
  const [loopTrack, setLoopTrack] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // ── Track mode state ─────────────────────────────────────────────────────────
  const [trackClips, setTrackClips] = useState<TrackClip[]>([]);
  const [trackMode, setTrackMode] = useState(false);
  const [trackPlaying, setTrackPlaying] = useState(false);
  const [trackCurrentIdx, setTrackCurrentIdx] = useState(-1);
  const playheadAnim = useRef(new Animated.Value(0)).current;
  const playheadAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const trackSoundRef = useRef<Audio.Sound | null>(null);
  const trackCancelRef = useRef(false);
  const trackPlayingRef = useRef(false);   // ref mirror avoids stale-closure guard
  const mutedCharIdsRef = useRef<Set<string>>(new Set()); // ref mirror for mute state
  const loopTrackRef = useRef(false);                    // ref mirror for loop toggle
  const trackScrollRef = useRef<ScrollView>(null);
  const playheadXRef = useRef(0);          // mirrors playheadAnim for PanResponder
  const dragStartXRef = useRef(0);         // playhead X at drag-start
  const handleTrackPlayRef = useRef<(startIndex?: number) => Promise<void>>(async () => {});
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);

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
    loadDocUri(sceneId).then(setDocUri);
  }, [sceneId]);

  // ── Init: default mute actor characters ──────────────────────────────────────
  useEffect(() => {
    const actorIds = characters.filter((c) => c.isActor).map((c) => c.id);
    const next = new Set(actorIds);
    setMutedCharIds(next);
    mutedCharIdsRef.current = next;
  }, [characters]);

  // Keep ref in sync so handleTrackPlay always reads the latest mute state
  useEffect(() => { mutedCharIdsRef.current = mutedCharIds; }, [mutedCharIds]);
  useEffect(() => { loopTrackRef.current = loopTrack; }, [loopTrack]);

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

  // ── Keep playheadXRef in sync with animation value ───────────────────────────
  useEffect(() => {
    const id = playheadAnim.addListener(({ value }) => { playheadXRef.current = value; });
    return () => playheadAnim.removeListener(id);
  }, [playheadAnim]);

  // (handleTrackPlayRef is updated after handleTrackPlay is declared — see below)

  // ── Mute toggle ──────────────────────────────────────────────────────────────
  const toggleMute = useCallback((charId: string) => {
    setMutedCharIds((prev) => {
      const next = new Set(prev);
      if (next.has(charId)) { next.delete(charId); } else { next.add(charId); }
      mutedCharIdsRef.current = next; // update ref immediately, before re-render
      // Rebuild TTS engine if in TTS mode
      const engine = engineRef.current;
      if (engine && !trackMode) {
        engine.pause();
        engine.load(lines, characters, next);
      }
      return next;
    });
  }, [lines, characters, trackMode]);

  // ── Playhead drag (PanResponder) ─────────────────────────────────────────────

  const playheadPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        // Capture position at drag start, then stop playback
        dragStartXRef.current = playheadXRef.current;
        trackCancelRef.current = true;
        trackPlayingRef.current = false;
        playheadAnimRef.current?.stop();
        trackSoundRef.current?.stopAsync().catch(() => {});
        trackSoundRef.current?.unloadAsync().catch(() => {});
        trackSoundRef.current = null;
        setTrackPlaying(false);
        setTrackCurrentIdx(-1);
        setIsDraggingPlayhead(true);
      },
      onPanResponderMove: (_, { dx }) => {
        const newX = Math.max(0, dragStartXRef.current + dx);
        playheadAnim.setValue(newX);
      },
      onPanResponderRelease: (_, { dx }) => {
        const finalX = Math.max(0, dragStartXRef.current + dx);
        playheadAnim.setValue(finalX);
        setIsDraggingPlayhead(false);
        // Map final X to nearest clip index
        const cumXs = clipCumXRef.current;
        let clipIndex = 0;
        for (let i = 0; i < cumXs.length; i++) {
          if (finalX >= cumXs[i]) clipIndex = i;
          else break;
        }
        handleTrackPlayRef.current(clipIndex);
      },
      onPanResponderTerminate: () => {
        setIsDraggingPlayhead(false);
      },
    })
  ).current;

  // ── Track playback ────────────────────────────────────────────────────────────

  // Compute cumulative X positions for each clip (for seek)
  const clipCumXRef = useRef<number[]>([]);
  useEffect(() => {
    let x = 0;
    clipCumXRef.current = trackClips.map((c) => {
      const pos = x;
      x += trackClipW(c) + TRACK_GAP;
      return pos;
    });
  }, [trackClips]);

  const handleTrackPlay = useCallback(async (startIndex = 0) => {
    if (trackClips.length === 0 || trackPlayingRef.current) return;
    trackCancelRef.current = false;
    trackPlayingRef.current = true;
    setTrackPlaying(true);
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

    let currentStart = startIndex;

    do {
      let cumX = clipCumXRef.current[currentStart] ?? 0;
      playheadAnim.setValue(cumX);

      for (let i = currentStart; i < trackClips.length; i++) {
        if (trackCancelRef.current) break;

        const clip = trackClips[i];
        const clipW = trackClipW(clip);
        const isMuted = mutedCharIdsRef.current.has(clip.characterId);
        const char = characters.find((c) => c.id === clip.characterId);
        const preMs = char?.voiceSettings.mutePreBufferMs ?? 0;
        const postMs = char?.voiceSettings.mutePostBufferMs ?? 0;

        setTrackCurrentIdx(i);
        trackScrollRef.current?.scrollTo({ x: Math.max(0, cumX - 16), animated: true });

        // Pre-buffer: pause before muted clip so actor has a moment to prepare
        if (isMuted && preMs > 0 && !trackCancelRef.current) {
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

        // Post-buffer: extra pause after muted clip so actor can finish their line
        if (isMuted && postMs > 0 && !trackCancelRef.current) {
          await new Promise<void>((resolve) => setTimeout(resolve, postMs));
        }

        cumX += clipW + TRACK_GAP;
      }

      currentStart = 0; // subsequent loops always restart from the beginning
      if (trackCancelRef.current) break;

      if (loopTrackRef.current) {
        // Brief pause + playhead reset between loops
        setTrackCurrentIdx(-1);
        await new Promise<void>((r) => setTimeout(r, 400));
        Animated.timing(playheadAnim, { toValue: 0, duration: 250, useNativeDriver: true }).start();
        await new Promise<void>((r) => setTimeout(r, 300));
      }
    } while (loopTrackRef.current && !trackCancelRef.current);

    trackPlayingRef.current = false;
    setTrackPlaying(false);
    setTrackCurrentIdx(-1);
  }, [trackClips, characters, playheadAnim, clipCumXRef]);

  // Keep ref current so PanResponder always calls the latest version
  useEffect(() => { handleTrackPlayRef.current = handleTrackPlay; }, [handleTrackPlay]);

  const handleTrackStop = useCallback(async () => {
    trackCancelRef.current = true;
    trackPlayingRef.current = false;
    playheadAnimRef.current?.stop();
    await trackSoundRef.current?.stopAsync().catch(() => {});
    await trackSoundRef.current?.unloadAsync().catch(() => {});
    trackSoundRef.current = null;
    setTrackPlaying(false);
    setTrackCurrentIdx(-1);
    Animated.timing(playheadAnim, { toValue: 0, duration: 250, useNativeDriver: true }).start();
  }, [playheadAnim]);

  const handleExport = useCallback(async () => {
    if (trackClips.length === 0) return;

    if (!FFmpegKit) {
      Alert.alert(
        'Export Unavailable',
        'Add ffmpeg-kit-react-native to the project and rebuild the dev client to enable export.'
      );
      return;
    }

    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      Alert.alert('Export Unavailable', 'Sharing is not supported on this device.');
      return;
    }

    setIsExporting(true);
    try {
      const outDir = `${FileSystem.documentDirectory}exports/`;
      await FileSystem.makeDirectoryAsync(outDir, { intermediates: true });
      const outPath = `${outDir}scene_${sceneId}_${Date.now()}.m4a`;

      // Build FFmpeg command: real clip files for unmuted, anullsrc silence for muted
      const inputArgs: string[] = [];
      const filterInputs: string[] = [];

      trackClips.forEach((clip, i) => {
        const isMuted = mutedCharIdsRef.current.has(clip.characterId);
        if (isMuted) {
          const durSec = (clip.durationMs / 1000).toFixed(3);
          inputArgs.push(`-f lavfi -t ${durSec} -i anullsrc=r=44100:cl=stereo`);
        } else {
          const path = clip.uri.replace(/^file:\/\//, '');
          inputArgs.push(`-i "${path}"`);
        }
        filterInputs.push(`[${i}:a]`);
      });

      const filterComplex = `${filterInputs.join('')}concat=n=${trackClips.length}:v=0:a=1[out]`;
      const outPathRaw = outPath.replace(/^file:\/\//, '');
      const cmd = `${inputArgs.join(' ')} -filter_complex "${filterComplex}" -map "[out]" -c:a aac -y "${outPathRaw}"`;

      const session = await FFmpegKit.execute(cmd);
      const returnCode = await session.getReturnCode();

      if (returnCode.isValueSuccess()) {
        await Sharing.shareAsync(outPath, {
          mimeType: 'audio/mp4',
          dialogTitle: 'Export Scene Audio',
          UTI: 'public.mpeg-4-audio',
        });
      } else {
        Alert.alert('Export Failed', 'Could not create audio file. Please try again.');
      }
    } catch (err) {
      Alert.alert('Export Failed', String(err));
    } finally {
      setIsExporting(false);
    }
  }, [trackClips, sceneId]);

  const handleTrackRestart = useCallback(async () => {
    await handleTrackStop();
  }, [handleTrackStop]);

  const handleSeekToClip = useCallback(async (clipIndex: number) => {
    // Stop any in-progress playback using the ref (avoids stale-closure from state)
    if (trackPlayingRef.current) {
      trackCancelRef.current = true;
      trackPlayingRef.current = false;
      playheadAnimRef.current?.stop();
      await trackSoundRef.current?.stopAsync().catch(() => {});
      await trackSoundRef.current?.unloadAsync().catch(() => {});
      trackSoundRef.current = null;
      setTrackPlaying(false);
      setTrackCurrentIdx(-1);
      await new Promise<void>((r) => setTimeout(r, 80));
    }
    // Jump playhead to the clip's position
    const x = clipCumXRef.current[clipIndex] ?? 0;
    playheadAnim.setValue(x);
    trackScrollRef.current?.scrollTo({ x: Math.max(0, x - 16), animated: true });
    handleTrackPlay(clipIndex);
  }, [handleTrackPlay, playheadAnim]);

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
      {characters.map((char) => {
        const muted = mutedCharIds.has(char.id);
        return (
          <Pressable
            key={char.id}
            onPress={() => toggleMute(char.id)}
            onLongPress={() => {
              setEditPre((char.voiceSettings.mutePreBufferMs ?? 0) / 1000);
              setEditPost((char.voiceSettings.mutePostBufferMs ?? 0) / 1000);
              setBufferEditChar(char);
            }}
            delayLongPress={350}
            style={[
              styles.charToggle,
              {
                backgroundColor: muted ? '#2a2a3a' : char.color + 'B3',
                borderColor: muted ? '#444' : char.color,
                borderWidth: muted ? 1 : 2,
              },
            ]}
          >
            <Text style={[styles.charToggleIcon, { color: muted ? '#555' : '#fff' }]}>
              {muted ? '🔇' : '🔊'}
            </Text>
            <Text
              style={[styles.charToggleName, { color: muted ? '#666' : '#fff' }]}
              numberOfLines={1}
            >
              {char.name}
            </Text>
            <Text style={[styles.charToggleHint, { color: muted ? '#333' : '#ffffff88' }]}>
              hold: buffer
            </Text>
          </Pressable>
        );
      })}
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
          {docUri && (
            <IconButton
              icon={showDoc ? 'file-eye' : 'file-eye-outline'}
              iconColor={showDoc ? '#6366F1' : '#555'}
              size={22}
              onPress={() => setShowDoc((v) => !v)}
            />
          )}
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
                ref={trackScrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                scrollEnabled={!isDraggingPlayhead}
                style={styles.trackScroll}
                contentContainerStyle={styles.trackContent}
              >
                {/* Clip blocks */}
                {trackClips.map((clip, i) => {
                  const w = trackClipW(clip);
                  const isMutedClip = mutedCharIds.has(clip.characterId);
                  const isCurrent = i === trackCurrentIdx;
                  return (
                    <Pressable
                      key={clip.id}
                      onPress={() => handleSeekToClip(i)}
                      style={[
                        styles.trackClipBlock,
                        {
                          width: w,
                          backgroundColor: isMutedClip
                            ? '#2a2a3a'
                            : clip.characterColor + 'B3',
                          borderColor: isCurrent ? clip.characterColor : '#ffffff44',
                          borderWidth: isCurrent ? 2 : 1,
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
                    </Pressable>
                  );
                })}

                {/* Playhead — draggable */}
                <Animated.View
                  style={[styles.playheadHitArea, { transform: [{ translateX: playheadAnim }] }]}
                  {...playheadPanResponder.panHandlers}
                >
                  <View style={[styles.playheadHandle, isDraggingPlayhead && styles.playheadHandleActive]} />
                  <View style={styles.playheadLine} />
                </Animated.View>
              </ScrollView>
            </View>

            {/* Controls */}
            <View style={styles.trackControls}>
              <IconButton
                icon={loopTrack ? 'repeat' : 'repeat-off'}
                iconColor={loopTrack ? '#6366F1' : '#555'}
                size={28}
                onPress={() => setLoopTrack((v) => !v)}
                style={styles.trackPlayBtn}
              />
              {trackPlaying ? (
                <IconButton
                  icon="stop-circle"
                  iconColor="#EF4444"
                  size={44}
                  onPress={handleTrackStop}
                  style={styles.trackPlayBtn}
                />
              ) : (
                <IconButton
                  icon="play-circle"
                  iconColor="#6366F1"
                  size={44}
                  onPress={() => handleTrackPlay()}
                  disabled={trackClips.length === 0}
                  style={styles.trackPlayBtn}
                />
              )}
              {isExporting ? (
                <ActivityIndicator size={20} style={{ marginHorizontal: 12 }} />
              ) : (
                <IconButton
                  icon="export-variant"
                  iconColor={trackClips.length > 0 ? '#888' : '#444'}
                  size={28}
                  onPress={handleExport}
                  disabled={trackClips.length === 0}
                  style={styles.trackPlayBtn}
                />
              )}
            </View>

            {/* Document viewer */}
            {docUri && showDoc && (
              <View style={styles.practiceDocPanel}>
                <WebView
                  source={{ uri: docUri }}
                  style={{ flex: 1 }}
                  originWhitelist={['*']}
                  allowFileAccess
                  allowingReadAccessToURL={FileSystem.documentDirectory ?? undefined}
                />
              </View>
            )}

            {/* Character mute chips */}
            <View style={styles.trackChipArea}>
              <Text variant="labelSmall" style={styles.trackChipHint}>
                Tap clip to seek · Tap chip to mute · Long-press for buffer
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
  // ── Playhead (draggable) ─────────────────────────────────────────────────────
  playheadHitArea: {
    position: 'absolute',
    top: 8,
    bottom: 8,
    left: 4,           // 16 (padding) - 12 (half of 24px hit width) = 4
    width: 24,
    alignItems: 'center',
    zIndex: 10,
  },
  playheadHandle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
    marginBottom: 2,
    opacity: 0.85,
  },
  playheadHandleActive: {
    backgroundColor: '#6366F1',
    opacity: 1,
    transform: [{ scale: 1.3 }],
  },
  playheadLine: {
    flex: 1,
    width: 2,
    borderRadius: 1,
    backgroundColor: '#fff',
    opacity: 0.9,
  },

  trackControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  trackPlayBtn: { margin: 0 },

  practiceDocPanel: {
    height: SCREEN_HEIGHT * 0.38,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#333',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#333',
  },
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
    gap: 10,
    justifyContent: 'center',
  },
  charToggle: {
    width: '30%',
    flexGrow: 1,
    minWidth: 80,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
  },
  charToggleIcon: { fontSize: 16 },
  charToggleName: { fontWeight: '700', fontSize: 12, textAlign: 'center' },
  charToggleHint: { fontSize: 8, textAlign: 'center' },

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
