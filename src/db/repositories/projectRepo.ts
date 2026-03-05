import { getDb } from '../database';
import type { Project } from '@/types';
import { generateId } from './utils';

interface ProjectRow {
  id: string;
  title: string;
  type: string;
  cover_image: string | null;
  created_at: number;
  updated_at: number;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    title: row.title,
    type: row.type as Project['type'],
    coverImage: row.cover_image ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export async function getAllProjects(): Promise<Project[]> {
  const db = getDb();
  const rows = await db.getAllAsync<ProjectRow>(
    'SELECT * FROM projects ORDER BY updated_at DESC'
  );
  return rows.map(rowToProject);
}

export async function getProjectById(id: string): Promise<Project | null> {
  const db = getDb();
  const row = await db.getFirstAsync<ProjectRow>(
    'SELECT * FROM projects WHERE id = ?',
    [id]
  );
  return row ? rowToProject(row) : null;
}

export async function createProject(
  data: Pick<Project, 'title' | 'type' | 'coverImage'>
): Promise<Project> {
  const db = getDb();
  const now = Date.now();
  const id = generateId();
  await db.runAsync(
    'INSERT INTO projects (id, title, type, cover_image, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, data.title, data.type, data.coverImage ?? null, now, now]
  );
  return { id, ...data, createdAt: new Date(now), updatedAt: new Date(now) };
}

export async function updateProject(
  id: string,
  data: Partial<Pick<Project, 'title' | 'type' | 'coverImage'>>
): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const sets: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [now];

  if (data.title !== undefined) { sets.push('title = ?'); values.push(data.title); }
  if (data.type !== undefined) { sets.push('type = ?'); values.push(data.type); }
  if (data.coverImage !== undefined) { sets.push('cover_image = ?'); values.push(data.coverImage ?? null); }

  values.push(id);
  await db.runAsync(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function deleteProject(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync('DELETE FROM projects WHERE id = ?', [id]);
}
