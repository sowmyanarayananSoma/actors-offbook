import { getDb } from '../database';
import type { Line } from '@/types';
import { generateId } from './utils';

interface LineRow {
  id: string;
  scene_id: string;
  character_id: string;
  text: string;
  sort_order: number;
  is_stage_direction: number;
  duration_ms: number | null;
  notes: string | null;
}

function rowToLine(row: LineRow): Line {
  return {
    id: row.id,
    sceneId: row.scene_id,
    characterId: row.character_id,
    text: row.text,
    order: row.sort_order,
    isStageDirection: row.is_stage_direction === 1,
    duration: row.duration_ms ?? undefined,
    notes: row.notes ?? undefined,
  };
}

export async function getLinesByScene(sceneId: string): Promise<Line[]> {
  const db = getDb();
  const rows = await db.getAllAsync<LineRow>(
    'SELECT * FROM lines WHERE scene_id = ? ORDER BY sort_order ASC',
    [sceneId]
  );
  return rows.map(rowToLine);
}

export async function getLineById(id: string): Promise<Line | null> {
  const db = getDb();
  const row = await db.getFirstAsync<LineRow>(
    'SELECT * FROM lines WHERE id = ?',
    [id]
  );
  return row ? rowToLine(row) : null;
}

export async function createLine(data: Omit<Line, 'id'>): Promise<Line> {
  const db = getDb();
  const id = generateId();
  await db.runAsync(
    'INSERT INTO lines (id, scene_id, character_id, text, sort_order, is_stage_direction, duration_ms, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, data.sceneId, data.characterId, data.text, data.order, data.isStageDirection ? 1 : 0, data.duration ?? null, data.notes ?? null]
  );
  return { id, ...data };
}

export async function bulkCreateLines(lines: Omit<Line, 'id'>[]): Promise<Line[]> {
  const db = getDb();
  const created: Line[] = [];
  await db.withTransactionAsync(async () => {
    for (const data of lines) {
      const id = generateId();
      await db.runAsync(
        'INSERT INTO lines (id, scene_id, character_id, text, sort_order, is_stage_direction, duration_ms, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, data.sceneId, data.characterId, data.text, data.order, data.isStageDirection ? 1 : 0, data.duration ?? null, data.notes ?? null]
      );
      created.push({ id, ...data });
    }
  });
  return created;
}

export async function updateLine(
  id: string,
  data: Partial<Pick<Line, 'text' | 'order' | 'isStageDirection' | 'duration' | 'notes' | 'characterId'>>
): Promise<void> {
  const db = getDb();
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if (data.text !== undefined) { sets.push('text = ?'); values.push(data.text); }
  if (data.order !== undefined) { sets.push('sort_order = ?'); values.push(data.order); }
  if (data.isStageDirection !== undefined) { sets.push('is_stage_direction = ?'); values.push(data.isStageDirection ? 1 : 0); }
  if (data.duration !== undefined) { sets.push('duration_ms = ?'); values.push(data.duration ?? null); }
  if (data.notes !== undefined) { sets.push('notes = ?'); values.push(data.notes ?? null); }
  if (data.characterId !== undefined) { sets.push('character_id = ?'); values.push(data.characterId); }

  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE lines SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function deleteLine(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync('DELETE FROM lines WHERE id = ?', [id]);
}

export async function deleteLinesByScene(sceneId: string): Promise<void> {
  const db = getDb();
  await db.runAsync('DELETE FROM lines WHERE scene_id = ?', [sceneId]);
}
