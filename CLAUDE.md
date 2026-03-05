# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Actors Offbook** — A React Native + Expo mobile app for actors to memorize lines. Actors import scripts, assign TTS voices to characters, and practice by muting their own character during playback.

## Commands

```bash
# Start development server
npx expo start

# Run on iOS simulator
npx expo start --ios

# Run on Android emulator
npx expo start --android

# Type check
npx tsc --noEmit

# Lint
npx eslint . --ext .ts,.tsx

# Run tests
npx jest

# Run single test file
npx jest path/to/test.test.ts

# Build for production (EAS)
npx eas build --platform ios
npx eas build --platform android
```

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | React Native + Expo (managed workflow) |
| Language | TypeScript |
| Navigation | Expo Router v3 (file-based, Expo default) |
| State | Zustand |
| UI | React Native Paper |
| Audio playback/recording | expo-av |
| Text-to-speech | expo-speech (built-in, offline) |
| Storage | expo-sqlite (structured data) + expo-secure-store |
| File import | expo-document-picker + expo-file-system |
| Gestures | react-native-gesture-handler |
| Animations | react-native-reanimated |
| Haptics | expo-haptics |
| Notifications | expo-notifications |

## Architecture

**Local-first.** All core features work offline. Cloud sync is a Phase 3 addition (Firebase or Supabase). No backend required for MVP.

### Navigation Structure
```
Root Stack
├── Onboarding (first launch only)
└── Main Tabs
    ├── Home — project list, quick resume, streak
    ├── Projects — browse/create projects
    └── Settings — theme, audio, reminders

Project Stack (modal over tabs)
├── ProjectDetail — scene list
├── SceneDetail — script view + character management
└── PracticeScreen — full-screen practice mode
    ├── Playback sub-mode
    ├── Mute sub-mode (primary)
    └── Recording sub-mode
```

### Data Models

```typescript
interface Project {
  id: string;
  title: string;
  type: 'play' | 'film' | 'tv' | 'commercial' | 'other';
  coverImage?: string;
  createdAt: Date;
  characters: Character[];   // shared across scenes
}

interface Scene {
  id: string;
  projectId: string;
  sceneNumber: string;
  title: string;
  lines: Line[];
  masteryStatus: 'not_started' | 'needs_work' | 'mastered';
  practiceStats: PracticeStats;
}

interface Character {
  id: string;
  projectId: string;
  name: string;
  color: string;             // hex, for UI color coding
  voiceSettings: VoiceSettings;
  isActor: boolean;          // true = the user's own character
}

interface Line {
  id: string;
  sceneId: string;
  characterId: string;
  text: string;
  order: number;
  isStageDirection: boolean;
  duration?: number;         // expected ms, set after first TTS playback
  notes?: string;
}

interface VoiceSettings {
  type: 'tts' | 'recording' | 'ai';
  pitch: number;             // 0.5–2.0
  rate: number;              // 0.5–2.0
  language: string;          // BCP-47 tag
  recordingUri?: string;     // for 'recording' type
}
```

### Audio Engine (Practice Screen)

The practice screen drives a sequential queue of `Line` objects. Key behaviors:
- **TTS lines**: queued via `expo-speech`, duration estimated by character count
- **Muted lines**: replaced with haptic + visual cue (flash + countdown bar)
- **Recorded lines**: played back via `expo-av` Audio
- Lock screen controls via `expo-av` audio session + media notification
- Background playback configured in `app.json` with `audio` background mode

### Script Parsing

PDF and DOCX files are parsed server-side (Phase 3) or handled via a lightweight on-device heuristic:
- Character names detected by ALL CAPS pattern on their own line
- Stage directions detected by parentheses or italics metadata
- Scene breaks detected by "SCENE", "INT.", "EXT." prefixes

For Phase 1, TXT import with manual curation is sufficient.

### Storage Schema (SQLite)

Tables: `projects`, `scenes`, `characters`, `lines`, `practice_sessions`, `recordings`

Use `expo-sqlite` with migration versioning. Keep migrations in `src/db/migrations/`.

## Development Phases

- **Phase 1 (MVP)**: Single project, TXT/PDF import, expo-speech TTS, mute mode, AsyncStorage → SQLite, iOS only
- **Phase 2**: Multi-scene, audio recording + comparison, Android, haptics, lock screen controls, SQLite
- **Phase 3**: Cloud sync, user accounts, ElevenLabs AI voices, OCR import, sharing
- **Phase 4**: Voice commands, widgets, CarPlay, Apple Watch, in-app purchases

## Key Constraints

- **Offline-first**: Every feature in Phase 1–2 must work with airplane mode on.
- **Background audio**: Must request `audio` background mode in `app.json`; test explicitly — Expo Go does not support background audio, use a dev build.
- **iOS first**: Target iOS 16+ for Phase 1. Android added in Phase 2.
- **Mute mode is the primary UX**: Design decisions should optimize for the practice screen experience above all else.

## Other considerations
- **Planning Input ** - Ask me any questions for design and development guidance as you work.
