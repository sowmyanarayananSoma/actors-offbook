import * as Haptics from 'expo-haptics';
import * as ttsService from './ttsService';
import type { Line, Character, PracticeLineItem, PracticeState } from '@/types';

export type PracticeEngineEvent =
  | { type: 'line_start'; item: PracticeLineItem; index: number }
  | { type: 'line_end'; item: PracticeLineItem }
  | { type: 'state_change'; state: PracticeState }
  | { type: 'scene_complete' }
  | { type: 'progress'; current: number; total: number };

type Listener = (event: PracticeEngineEvent) => void;

export class PracticeEngine {
  private queue: PracticeLineItem[] = [];
  private currentIndex = 0;
  private state: PracticeState = 'idle';
  private listeners: Listener[] = [];
  private muteTimer: ReturnType<typeof setTimeout> | null = null;
  private preBufferTimer: ReturnType<typeof setTimeout> | null = null;
  private stageTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── Public API ────────────────────────────────────────────────────────────

  load(lines: Line[], characters: Character[], mutedCharacterIds: Set<string>): void {
    this.queue = lines.map((line) => {
      const character = characters.find((c) => c.id === line.characterId)!;
      const isMuted = mutedCharacterIds.has(line.characterId);
      const estimatedDurationMs = ttsService.estimateDurationMs(
        line.text,
        character?.voiceSettings.rate ?? 1.0
      );
      return { line, character, isMuted, estimatedDurationMs };
    });
    this.currentIndex = 0;
    this.setState('idle');
  }

  play(): void {
    if (this.state === 'complete') return;
    if (this.state === 'paused') {
      this.setState('playing');
      this.playCurrentLine();
      return;
    }
    if (this.state === 'idle') {
      this.setState('playing');
      this.playCurrentLine();
    }
  }

  pause(): void {
    if (this.state === 'playing' || this.state === 'muted_waiting') {
      ttsService.stop();
      this.clearTimers();
      this.setState('paused');
    }
  }

  skipLine(): void {
    ttsService.stop();
    this.clearTimers();
    this.advance();
  }

  previousLine(): void {
    ttsService.stop();
    this.clearTimers();
    if (this.currentIndex > 0) {
      this.currentIndex--;
    }
    if (this.state === 'playing' || this.state === 'muted_waiting') {
      this.playCurrentLine();
    }
  }

  restart(): void {
    ttsService.stop();
    this.clearTimers();
    this.currentIndex = 0;
    this.setState('idle');
  }

  get currentItem(): PracticeLineItem | null {
    return this.queue[this.currentIndex] ?? null;
  }

  get currentLineIndex(): number {
    return this.currentIndex;
  }

  get totalLines(): number {
    return this.queue.length;
  }

  get practiceState(): PracticeState {
    return this.state;
  }

  on(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  destroy(): void {
    ttsService.stop();
    this.clearTimers();
    this.listeners = [];
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private emit(event: PracticeEngineEvent): void {
    this.listeners.forEach((l) => l(event));
  }

  private setState(state: PracticeState): void {
    this.state = state;
    this.emit({ type: 'state_change', state });
  }

  private playCurrentLine(): void {
    if (this.currentIndex >= this.queue.length) {
      this.setState('complete');
      this.emit({ type: 'scene_complete' });
      return;
    }

    const item = this.queue[this.currentIndex];
    this.emit({ type: 'line_start', item, index: this.currentIndex });
    this.emit({ type: 'progress', current: this.currentIndex, total: this.queue.length });

    if (item.line.isStageDirection) {
      // Stage directions auto-advance after 1.5s display
      this.stageTimer = setTimeout(() => {
        this.emit({ type: 'line_end', item });
        this.advance();
      }, 1500);
      return;
    }

    if (item.isMuted) {
      // Muted line: haptic + countdown timer (with optional pre/post buffers)
      const preMs = item.character.voiceSettings.mutePreBufferMs ?? 0;
      const postMs = item.character.voiceSettings.mutePostBufferMs ?? 0;
      this.setState('muted_waiting');
      if (preMs > 0) {
        this.preBufferTimer = setTimeout(() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }, preMs);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      this.muteTimer = setTimeout(() => {
        this.emit({ type: 'line_end', item });
        this.setState('playing');
        this.advance();
      }, preMs + item.estimatedDurationMs + postMs);
    } else {
      // TTS line
      this.setState('playing');
      ttsService.speak(item.line.text, item.character.voiceSettings, () => {
        if (this.state !== 'paused') {
          this.emit({ type: 'line_end', item });
          this.advance();
        }
      });
    }
  }

  private advance(): void {
    this.currentIndex++;
    if (this.state !== 'paused') {
      this.playCurrentLine();
    }
  }

  private clearTimers(): void {
    if (this.muteTimer !== null) {
      clearTimeout(this.muteTimer);
      this.muteTimer = null;
    }
    if (this.preBufferTimer !== null) {
      clearTimeout(this.preBufferTimer);
      this.preBufferTimer = null;
    }
    if (this.stageTimer !== null) {
      clearTimeout(this.stageTimer);
      this.stageTimer = null;
    }
  }
}
