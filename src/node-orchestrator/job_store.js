/**
 * Job store — SQLite is source of truth, JSON is export.
 * server.js imports this module; falls back to JSON-only when node:sqlite
 * is unavailable (Node < 22.5). Eliminates hits/jobs.json/aeo_jobs.db triple-write races.
 */
import fs from 'fs';
import path from 'path';

let Db = null;
let db = null;

export function initJobStore(dataDir) {
  try {
    if (!db) {
      import('node:sqlite').then(({ DatabaseSync }) => {
        try {
          Db = DatabaseSync;
          db = new DatabaseSync(path.join(dataDir, 'aeo_jobs.db'));
          db.exec(`CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, status TEXT, run_id TEXT, updated_at TEXT, payload TEXT);
                   CREATE TABLE IF NOT EXISTS runs (run_dir TEXT PRIMARY KEY, updated_at TEXT, payload TEXT);
                   CREATE TABLE IF NOT EXISTS audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, type TEXT, payload TEXT)`);
        } catch {}
      }).catch(() => { db = null; });
    }
  } catch { db = null; }
  return true;
}

export function writeJob(id, record) {
  if (!db) return false;
  try {
    db.prepare('INSERT OR REPLACE INTO jobs (id, status, run_id, updated_at, payload) VALUES (?, ?, ?, ?, ?)')
      .run(id, record.status || '', record.runId || '', new Date().toISOString(), JSON.stringify(record));
    return true;
  } catch { return false; }
}

export function readJobs() {
  if (!db) return null;
  try {
    return db.prepare('SELECT id, payload FROM jobs ORDER BY updated_at DESC LIMIT 200').all()
      .map((r) => { try { return [r.id, JSON.parse(r.payload)]; } catch { return [r.id, {}]; } });
  } catch { return null; }
}

export function writeAudit(type, details = {}) {
  if (!db) return false;
  try {
    db.prepare('INSERT INTO audit_events (ts, type, payload) VALUES (?, ?, ?)')
      .run(new Date().toISOString(), type, JSON.stringify(details));
    return true;
  } catch { return false; }
}
