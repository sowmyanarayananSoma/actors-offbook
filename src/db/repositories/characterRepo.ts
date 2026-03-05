import { getDb } from '../database';
import type { Character, VoiceSettings } from '@/types';
import { generateId } from './utils';

interface CharacterRow {
  id: string;
  project_id: string;
  name: string;
  color: string;
  voice_settings: string;
  is_actor: number;
}

const DEFAULT_VOICE: VoiceSettings = {
  type: 'tts',
  pitch: 1.0,
  rate: 1.0,
  language: 'en-US',
};

function rowToCharacter(row: CharacterRow): Character {
  let voiceSettings: VoiceSettings = DEFAULT_VOICE;
  try {
    voiceSettings = JSON.parse(row.voice_settings);
  } catch {
    // keep default
  }
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    color: row.color,
    voiceSettings,
    isActor: row.is_actor === 1,
  };
}

export async function getCharactersByProject(projectId: string): Promise<Character[]> {
  const db = getDb();
  const rows = await db.getAllAsync<CharacterRow>(
    'SELECT * FROM characters WHERE project_id = ? ORDER BY name ASC',
    [projectId]
  );
  return rows.map(rowToCharacter);
}

export async function getCharacterById(id: string): Promise<Character | null> {
  const db = getDb();
  const row = await db.getFirstAsync<CharacterRow>(
    'SELECT * FROM characters WHERE id = ?',
    [id]
  );
  return row ? rowToCharacter(row) : null;
}

export async function createCharacter(
  data: Omit<Character, 'id'>
): Promise<Character> {
  const db = getDb();
  const id = generateId();
  await db.runAsync(
    'INSERT INTO characters (id, project_id, name, color, voice_settings, is_actor) VALUES (?, ?, ?, ?, ?, ?)',
    [id, data.projectId, data.name, data.color, JSON.stringify(data.voiceSettings), data.isActor ? 1 : 0]
  );
  return { id, ...data };
}

export async function updateCharacter(
  id: string,
  data: Partial<Omit<Character, 'id' | 'projectId'>>
): Promise<void> {
  const db = getDb();
  const sets: string[] = [];
  const values: (string | number)[] = [];

  if (data.name !== undefined) { sets.push('name = ?'); values.push(data.name); }
  if (data.color !== undefined) { sets.push('color = ?'); values.push(data.color); }
  if (data.voiceSettings !== undefined) { sets.push('voice_settings = ?'); values.push(JSON.stringify(data.voiceSettings)); }
  if (data.isActor !== undefined) { sets.push('is_actor = ?'); values.push(data.isActor ? 1 : 0); }

  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE characters SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function deleteCharacter(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync('DELETE FROM characters WHERE id = ?', [id]);
}

/** Clears isActor on all characters in the project, then sets it for one. */
export async function setActorCharacter(projectId: string, characterId: string): Promise<void> {
  const db = getDb();
  await db.runAsync('UPDATE characters SET is_actor = 0 WHERE project_id = ?', [projectId]);
  await db.runAsync('UPDATE characters SET is_actor = 1 WHERE id = ?', [characterId]);
}
