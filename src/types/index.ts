// ─── Voice & Practice ────────────────────────────────────────────────────────

export type PromptLevel = 'hidden' | 'first_word' | 'full_text';

export interface RecordingSegment {
  id: string;          // unique id (generateId from db/repositories/utils)
  uri: string;         // file:// path to .m4a
  durationMs: number;  // actual recorded duration
}

/** A clip on the scene-level master recording track. */
export interface TrackClip {
  id: string;
  characterId: string;
  characterName: string;   // denormalized for display
  characterColor: string;  // denormalized for display
  uri: string;             // file:// path to .m4a
  durationMs: number;
  transcript?: string;     // STT result, may be empty if recognition unavailable
}

export interface VoiceSettings {
  type: 'tts' | 'recording' | 'ai';
  pitch: number;       // 0.5–2.0
  rate: number;        // 0.5–2.0
  language: string;    // BCP-47 tag e.g. "en-US"
  recordingUri?: string;          // deprecated — single URI, kept for compat
  segments?: RecordingSegment[];  // ordered list of recorded takes
  mutePreBufferMs?: number;       // silence before muted line countdown begins
  mutePostBufferMs?: number;      // silence after muted line countdown ends
}

export interface PracticeStats {
  totalSessions: number;
  lastPracticed?: Date;
  averageAccuracy?: number; // Phase 2
}

// ─── Core data models ─────────────────────────────────────────────────────────

export interface Project {
  id: string;
  title: string;
  type: 'play' | 'film' | 'tv' | 'commercial' | 'other';
  coverImage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Character {
  id: string;
  projectId: string;
  name: string;
  color: string;              // hex color for UI
  voiceSettings: VoiceSettings;
  isActor: boolean;           // true = the user's own character
}

export interface Scene {
  id: string;
  projectId: string;
  sceneNumber: string;
  title: string;
  sortOrder: number;
  masteryStatus: 'not_started' | 'needs_work' | 'mastered';
  practiceStats: PracticeStats;
}

export interface Line {
  id: string;
  sceneId: string;
  characterId: string;
  text: string;
  order: number;
  isStageDirection: boolean;
  duration?: number;         // expected ms, set after first TTS playback
  notes?: string;
}

// ─── Script parsing ───────────────────────────────────────────────────────────

export type LineType =
  | 'dialogue'
  | 'parenthetical'  // (beat), (quietly) — inline under a character cue
  | 'action'         // narrative prose / action line
  | 'scene_heading'  // INT./EXT. sluglines (stored as stage directions)
  | 'transition';    // FADE IN:, CUT TO:, etc.

export interface ParsedLine {
  text: string;
  characterName: string | null; // null = stage direction
  isStageDirection: boolean;
  lineType: LineType;
  order: number;
}

export interface ParsedScene {
  sceneNumber: string;
  title: string;
  lines: ParsedLine[];
}

export interface ParsedScript {
  scenes: ParsedScene[];
  characters: string[];  // raw detected character names
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface AppSettings {
  promptLevel: PromptLevel;
  playbackSpeed: number;   // 0.5–2.0
  theme: 'light' | 'dark' | 'auto';
}

// ─── Practice engine ─────────────────────────────────────────────────────────

export type PracticeState =
  | 'idle'
  | 'playing'
  | 'muted_waiting'
  | 'paused'
  | 'complete';

export interface PracticeLineItem {
  line: Line;
  character: Character;
  isMuted: boolean;
  estimatedDurationMs: number;
}
