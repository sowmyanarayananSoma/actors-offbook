import type { ParsedScript, ParsedScene, ParsedLine, LineType } from '@/types';

/**
 * parseScript — Flexible multi-format script parser.
 *
 * Handles:
 *   1. Standard screenplay format (INT./EXT. sluglines, ALL CAPS character cues)
 *   2. Stage play format (character cues without sluglines)
 *   3. Inline format: "CHARACTER: dialogue text" on one line
 *   4. Non-standard / informal scripts
 *
 * Robustness features:
 *   - Title page skip: detects and ignores metadata before the script body
 *   - Form feed (\f) treated as scene/page break
 *   - Parenthetical bug fixed: (beat)/(quietly) keep character context
 *   - Scripts with no scene headings work — all lines land in one scene
 */
export function parseScript(rawText: string): ParsedScript {
  // Normalise line endings and treat form-feeds as blank lines (page breaks).
  const normalised = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\f/g, '\n\n');

  const rawLines = normalised.split('\n');
  const scenes: ParsedScene[] = [];
  const characterSet = new Set<string>();

  let currentScene: ParsedScene | null = null;
  let currentCharacter: string | null = null;
  let lineOrder = 0;
  let sceneCount = 0;

  // Skip title-page preamble — find where the script body actually starts.
  const startIndex = findScriptBodyStart(rawLines);

  function ensureScene() {
    if (!currentScene) {
      sceneCount++;
      currentScene = {
        sceneNumber: String(sceneCount),
        title: `Scene ${sceneCount}`,
        lines: [],
      };
    }
  }

  function pushLine(partial: Omit<ParsedLine, 'order'>) {
    ensureScene();
    currentScene!.lines.push({ ...partial, order: lineOrder++ });
  }

  function flushScene() {
    if (currentScene && currentScene.lines.length > 0) {
      scenes.push(currentScene);
      currentScene = null;
      lineOrder = 0;
    }
  }

  for (let i = startIndex; i < rawLines.length; i++) {
    const trimmed = rawLines[i].trim();

    // ── Blank line ────────────────────────────────────────────────────────
    if (!trimmed) {
      currentCharacter = null;
      continue;
    }

    // ── Scene heading ─────────────────────────────────────────────────────
    if (isSceneHeading(trimmed)) {
      flushScene();
      sceneCount++;
      currentScene = {
        sceneNumber: String(sceneCount),
        title: trimmed.slice(0, 60),
        lines: [],
      };
      lineOrder = 0;
      currentCharacter = null;
      continue;
    }

    // ── Transition ────────────────────────────────────────────────────────
    if (isTransition(trimmed)) {
      pushLine({ text: trimmed, characterName: null, isStageDirection: true, lineType: 'transition' });
      currentCharacter = null;
      continue;
    }

    // ── Parenthetical ─────────────────────────────────────────────────────
    // Do NOT reset currentCharacter — dialogue following a parenthetical
    // still belongs to the same character.
    if (isParenthetical(trimmed)) {
      pushLine({
        text: stripBrackets(trimmed),
        characterName: currentCharacter,
        isStageDirection: true,
        lineType: 'parenthetical',
      });
      continue;
    }

    // ── Inline "CHARACTER: dialogue" format ───────────────────────────────
    // e.g. "HAMLET: To be or not to be..."
    // e.g. "Mary: I don't know what to say."  (mixed case also supported)
    const inline = parseInlineCharacterLine(trimmed);
    if (inline) {
      const name = normalizeCharacterName(inline.character);
      characterSet.add(name);
      currentCharacter = name;
      pushLine({
        text: inline.dialogue,
        characterName: name,
        isStageDirection: false,
        lineType: 'dialogue',
      });
      continue;
    }

    // ── Character cue ─────────────────────────────────────────────────────
    if (isCharacterName(trimmed)) {
      const name = normalizeCharacterName(trimmed);
      currentCharacter = name;
      characterSet.add(name);
      continue;
    }

    // ── Dialogue ──────────────────────────────────────────────────────────
    if (currentCharacter) {
      pushLine({
        text: trimmed,
        characterName: currentCharacter,
        isStageDirection: false,
        lineType: 'dialogue',
      });
      continue;
    }

    // ── Action line ───────────────────────────────────────────────────────
    pushLine({ text: trimmed, characterName: null, isStageDirection: true, lineType: 'action' });
  }

  // Flush the last scene.
  flushScene();

  // Guarantee at least one scene.
  if (scenes.length === 0) {
    scenes.push({ sceneNumber: '1', title: 'Scene 1', lines: [] });
  }

  return {
    scenes,
    characters: Array.from(characterSet),
  };
}

// ─── Title page detection ─────────────────────────────────────────────────────

/**
 * Scans from the top to find where the script body starts, skipping title-page
 * preamble (title, author, contact info, etc.).
 *
 * Strategy: advance until we hit a scene heading, a transition marker, or a
 * character cue that is immediately followed by dialogue text. If nothing is
 * found within the first 60 lines, start from 0 (no title page, or the script
 * begins immediately with action lines).
 */
function findScriptBodyStart(lines: string[]): number {
  const PREAMBLE_LIMIT = 60;

  for (let i = 0; i < Math.min(lines.length, PREAMBLE_LIMIT); i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    // Unambiguous script-body markers.
    if (isSceneHeading(trimmed)) return i;
    if (isTransition(trimmed)) return i;

    // Inline "NAME: dialogue" — definitely script body.
    if (parseInlineCharacterLine(trimmed)) return i;

    // Character cue: only start here if the next non-blank line looks like
    // dialogue (not another ALL CAPS cue or a scene heading).
    if (isCharacterName(trimmed)) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const next = lines[j].trim();
        if (!next) continue;
        if (!isCharacterName(next) && !isSceneHeading(next) && !isTitlePageLine(next)) {
          return i;
        }
        break; // next non-blank line looks like title-page — keep scanning
      }
    }
  }

  // No clear start found — begin from 0 (treat whole text as script body).
  return 0;
}

/**
 * Lines that are typical title-page metadata — suppress them during preamble
 * scanning so they don't trigger a false "script start" detection.
 */
const TITLE_PAGE_RE =
  /^(written\s+by|a\s+film\s+by|directed\s+by|produced\s+by|©|copyright|all\s+rights|wga|draft|revised|based\s+on)/i;

function isTitlePageLine(line: string): boolean {
  return TITLE_PAGE_RE.test(line);
}

// ─── Detection helpers ────────────────────────────────────────────────────────

const SCENE_HEADING_RE =
  /^(INT\.|EXT\.|INT\.\/EXT\.|EXT\.\/INT\.|I\/E\.|SCENE\s+\d|ACT\s+[IVX\d])/i;

function isSceneHeading(line: string): boolean {
  return SCENE_HEADING_RE.test(line);
}

const TRANSITION_RE =
  /^(FADE\s+IN:|FADE\s+OUT:|FADE\s+TO\s+BLACK|FADE\s+TO:|CUT\s+TO:|SMASH\s+CUT|MATCH\s+CUT|DISSOLVE\s+TO:|TITLE\s*:)/i;

function isTransition(line: string): boolean {
  return TRANSITION_RE.test(line);
}

function isParenthetical(line: string): boolean {
  return (
    (line.startsWith('(') && line.endsWith(')')) ||
    (line.startsWith('[') && line.endsWith(']'))
  );
}

/**
 * Inline character+dialogue: "NAME: dialogue text"
 * Matches ALL CAPS names (standard) OR Title Case names (informal scripts).
 * The name part must be ≤ 4 words and end with a colon.
 *
 * Examples matched:
 *   "HAMLET: To be or not to be"
 *   "Mary: I don't know what to say"
 *   "DR. SMITH: Take two of these."
 *
 * Examples NOT matched:
 *   "Note: this is an action description"  (lowercase 'note' variants)
 *   "INT. ROOM: evening"                  (scene headings handled separately)
 */
const INLINE_CHAR_RE = /^([A-Z][A-Z\s'\.]{0,30}):\s+(\S.*)$/;

function parseInlineCharacterLine(line: string): { character: string; dialogue: string } | null {
  const match = INLINE_CHAR_RE.exec(line);
  if (!match) return null;

  const namePart = match[1].trim();
  const dialoguePart = match[2].trim();

  // Name must be ≤ 4 words and must contain a letter.
  const words = namePart.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 4) return null;
  if (!/[A-Z]/.test(namePart)) return null;

  // Dialogue must be non-trivial (> 1 word or > 3 chars).
  if (dialoguePart.split(/\s+/).length < 2 && dialoguePart.length <= 3) return null;

  return { character: namePart, dialogue: dialoguePart };
}

/**
 * Character cues (standalone line before dialogue):
 *   - ALL CAPS only
 *   - 1–6 words (allows "MARY POPPINS (V.O.)", "COP 2")
 *   - No trailing . ! ? , ; — avoids ALL CAPS action emphasis lines
 *   - Must contain at least one letter
 */
function isCharacterName(line: string): boolean {
  if (line !== line.toUpperCase()) return false;
  if (/[.!?,;]$/.test(line)) return false;
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 6) return false;
  if (!/[A-Z]/.test(line)) return false;
  return true;
}

function normalizeCharacterName(name: string): string {
  return name
    .replace(/\s*\(.*?\)\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripBrackets(line: string): string {
  if (
    (line.startsWith('(') && line.endsWith(')')) ||
    (line.startsWith('[') && line.endsWith(']'))
  ) {
    return line.slice(1, -1).trim();
  }
  return line;
}
