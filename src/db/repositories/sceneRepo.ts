import { getDb } from '../database';
import type { Scene, PracticeStats } from '@/types';
import { generateId } from './utils';

interface SceneRow {
  id: string;
  project_id: string;
  scene_number: string;
  title: string;
  sort_order: number;
  mastery_status: string;
  practice_stats: string;
}

const DEFAULT_STATS: PracticeStats = { totalSessions: 0 };

function rowToScene(row: SceneRow): Scene {
  let practiceStats: PracticeStats = DEFAULT_STATS;
  try {
    practiceStats = JSON.parse(row.practice_stats);
  } catch {
    // keep default
  }
  return {
    id: row.id,
    projectId: row.project_id,
    sceneNumber: row.scene_number,
    title: row.title,
    sortOrder: row.sort_order,
    masteryStatus: row.mastery_status as Scene['masteryStatus'],
    practiceStats,
  };
}

export async function getScenesByProject(projectId: string): Promise<Scene[]> {
  const db = getDb();
  const rows = await db.getAllAsync<SceneRow>(
    'SELECT * FROM scenes WHERE project_id = ? ORDER BY sort_order ASC',
    [projectId]
  );
  return rows.map(rowToScene);
}

export async function getSceneById(id: string): Promise<Scene | null> {
  const db = getDb();
  const row = await db.getFirstAsync<SceneRow>(
    'SELECT * FROM scenes WHERE id = ?',
    [id]
  );
  return row ? rowToScene(row) : null;
}

export async function createScene(
  data: Pick<Scene, 'projectId' | 'sceneNumber' | 'title' | 'sortOrder'>
): Promise<Scene> {
  const db = getDb();
  const id = generateId();
  const stats = DEFAULT_STATS;
  await db.runAsync(
    'INSERT INTO scenes (id, project_id, scene_number, title, sort_order, mastery_status, practice_stats) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, data.projectId, data.sceneNumber, data.title, data.sortOrder, 'not_started', JSON.stringify(stats)]
  );
  return {
    id,
    projectId: data.projectId,
    sceneNumber: data.sceneNumber,
    title: data.title,
    sortOrder: data.sortOrder,
    masteryStatus: 'not_started',
    practiceStats: stats,
  };
}

export async function updateScene(
  id: string,
  data: Partial<Pick<Scene, 'title' | 'sceneNumber' | 'sortOrder' | 'masteryStatus' | 'practiceStats'>>
): Promise<void> {
  const db = getDb();
  const sets: string[] = [];
  const values: (string | number)[] = [];

  if (data.title !== undefined) { sets.push('title = ?'); values.push(data.title); }
  if (data.sceneNumber !== undefined) { sets.push('scene_number = ?'); values.push(data.sceneNumber); }
  if (data.sortOrder !== undefined) { sets.push('sort_order = ?'); values.push(data.sortOrder); }
  if (data.masteryStatus !== undefined) { sets.push('mastery_status = ?'); values.push(data.masteryStatus); }
  if (data.practiceStats !== undefined) { sets.push('practice_stats = ?'); values.push(JSON.stringify(data.practiceStats)); }

  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE scenes SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function deleteScene(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync('DELETE FROM scenes WHERE id = ?', [id]);
}
