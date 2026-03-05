import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export async function initDatabase(): Promise<void> {
  db = await SQLite.openDatabaseAsync('actorsoffbook.db');
  await runMigrations(db);
}

async function runMigrations(database: SQLite.SQLiteDatabase): Promise<void> {
  // Create migrations tracking table
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = await database.getAllAsync<{ version: number }>(
    'SELECT version FROM schema_migrations ORDER BY version ASC'
  );
  const appliedVersions = new Set(applied.map((r) => r.version));

  if (!appliedVersions.has(1)) {
    await migration001(database);
    await database.runAsync(
      'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
      [1, Date.now()]
    );
  }
}

async function migration001(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'play',
      cover_image TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6B7280',
      voice_settings TEXT NOT NULL DEFAULT '{}',
      is_actor INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scenes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      scene_number TEXT NOT NULL,
      title TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      mastery_status TEXT NOT NULL DEFAULT 'not_started',
      practice_stats TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lines (
      id TEXT PRIMARY KEY,
      scene_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      text TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_stage_direction INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      notes TEXT,
      FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS practice_sessions (
      id TEXT PRIMARY KEY,
      scene_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      lines_completed INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_characters_project ON characters(project_id);
    CREATE INDEX IF NOT EXISTS idx_scenes_project ON scenes(project_id);
    CREATE INDEX IF NOT EXISTS idx_lines_scene ON lines(scene_id);
  `);
}
