import { StudyFlowSnapshot, SyncOperation, LocalBackup } from './types';
import { logger } from '@/lib/logger';

const DB_NAME = 'studyflow';
const DB_VERSION = 2;
const SNAPSHOTS_STORE = 'snapshots';
const SYNC_QUEUE_STORE = 'syncQueue';
const BACKUPS_STORE = 'backups';

type StoreName = typeof SNAPSHOTS_STORE | typeof SYNC_QUEUE_STORE | typeof BACKUPS_STORE;

let databasePromise: Promise<IDBDatabase> | null = null;
let sqliteDbPromise: Promise<any> | null = null;

export function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;
}

function ensureBrowser() {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is not available in this environment.');
  }
}

export function openStudyFlowDb(): Promise<IDBDatabase> {
  ensureBrowser();

  databasePromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
        db.createObjectStore(SNAPSHOTS_STORE, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(SYNC_QUEUE_STORE)) {
        db.createObjectStore(SYNC_QUEUE_STORE, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(BACKUPS_STORE)) {
        db.createObjectStore(BACKUPS_STORE, { keyPath: 'id' });
      }
    };

    request.onerror = () => reject(request.error ?? new Error('Unable to open local database.'));
    request.onsuccess = () => resolve(request.result);
  });

  return databasePromise;
}

async function getSqliteDb(): Promise<any> {
  if (!isTauri()) {
    throw new Error('SQLite is only available in Tauri desktop application.');
  }

  sqliteDbPromise ??= (async () => {
    try {
      const Database = (await import('@tauri-apps/plugin-sql')).default;
      const db = await Database.load('sqlite:studyflow.db');

      // Create required tables & schemas dynamically
      await db.execute(`
        CREATE TABLE IF NOT EXISTS snapshots (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS sync_queue (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          attempts INTEGER NOT NULL,
          last_error TEXT,
          next_attempt_at TEXT
        );
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS future_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // Add indexes for performance optimization
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_sync_queue_created_at ON sync_queue (created_at);
      `);

      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_future_metadata_updated_at ON future_metadata (updated_at);
      `);

      return db;
    } catch (err) {
      logger.error('Failed to initialize SQLite Database:', err);
      sqliteDbPromise = null; // reset so next call can try again
      throw err;
    }
  })();

  return sqliteDbPromise;
}

function withStore<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | undefined> {
  return openStudyFlowDb().then((db) => (
    new Promise<T | undefined>((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const request = callback(store);
      let result: T | undefined;

      if (request) {
        request.onsuccess = () => {
          result = request.result;
        };
        request.onerror = () => reject(request.error ?? new Error('Local database request failed.'));
      }

      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error('Local database transaction failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Local database transaction aborted.'));
    })
  ));
}

export async function readSnapshot(): Promise<StudyFlowSnapshot | null> {
  if (isTauri()) {
    try {
      const db = await getSqliteDb();
      const rows = await db.select('SELECT data FROM snapshots WHERE id = ?', ['default']);
      if (rows && rows.length > 0) {
        return JSON.parse((rows[0] as any).data);
      }
      return null;
    } catch (err) {
      logger.error('Failed to read snapshot from SQLite:', err);
      return null;
    }
  }

  const snapshot = await withStore<StudyFlowSnapshot>(SNAPSHOTS_STORE, 'readonly', (store) => store.get('default'));
  return snapshot ?? null;
}

export async function writeSnapshot(snapshot: StudyFlowSnapshot): Promise<void> {
  if (isTauri()) {
    try {
      const db = await getSqliteDb();
      await db.execute(
        'INSERT OR REPLACE INTO snapshots (id, data, updated_at) VALUES (?, ?, ?)',
        ['default', JSON.stringify(snapshot), snapshot.updatedAt || new Date().toISOString()]
      );
      return;
    } catch (err) {
      logger.error('Failed to write snapshot to SQLite:', err);
      throw err;
    }
  }

  await withStore(SNAPSHOTS_STORE, 'readwrite', (store) => {
    store.put(snapshot);
  });
}

export async function readSyncQueue(): Promise<SyncOperation[]> {
  if (isTauri()) {
    try {
      const db = await getSqliteDb();
      const rows = await db.select('SELECT * FROM sync_queue');
      const ops = rows.map((row: any) => ({
        id: row.id,
        type: row.type,
        payload: JSON.parse(row.payload),
        createdAt: row.created_at,
        attempts: Number(row.attempts),
        lastError: row.last_error || undefined,
        nextAttemptAt: row.next_attempt_at || undefined,
      }));
      return ops.sort((a: SyncOperation, b: SyncOperation) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    } catch (err) {
      logger.error('Failed to read sync queue from SQLite:', err);
      return [];
    }
  }

  const operations = await withStore<SyncOperation[]>(SYNC_QUEUE_STORE, 'readonly', (store) => store.getAll());
  const list = operations ?? [];
  return list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function writeSyncOperation(operation: SyncOperation): Promise<void> {
  if (isTauri()) {
    try {
      const db = await getSqliteDb();
      await db.execute(
        'INSERT OR REPLACE INTO sync_queue (id, type, payload, created_at, attempts, last_error, next_attempt_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          operation.id,
          operation.type,
          JSON.stringify(operation.payload),
          operation.createdAt,
          operation.attempts,
          operation.lastError || null,
          operation.nextAttemptAt || null,
        ]
      );
      return;
    } catch (err) {
      logger.error('Failed to write sync operation to SQLite:', err);
      throw err;
    }
  }

  await withStore(SYNC_QUEUE_STORE, 'readwrite', (store) => {
    store.put(operation);
  });
}

export async function deleteSyncOperation(operationId: string): Promise<void> {
  if (isTauri()) {
    try {
      const db = await getSqliteDb();
      await db.execute('DELETE FROM sync_queue WHERE id = ?', [operationId]);
      return;
    } catch (err) {
      logger.error('Failed to delete sync operation from SQLite:', err);
      throw err;
    }
  }

  await withStore(SYNC_QUEUE_STORE, 'readwrite', (store) => {
    store.delete(operationId);
  });
}

export async function readBackups(): Promise<LocalBackup[]> {
  if (isTauri()) {
    try {
      const { appDataDir, join } = await import('@tauri-apps/api/path');
      const { exists, mkdir, readDir, readTextFile } = await import('@tauri-apps/plugin-fs');

      const appDir = await appDataDir();
      const backupDir = await join(appDir, 'StudyFlow Backups');

      if (!(await exists(backupDir))) {
        await mkdir(backupDir, { recursive: true });
        return [];
      }

      const entries = await readDir(backupDir);
      const list: LocalBackup[] = [];

      for (const entry of entries) {
        if (entry.isFile && entry.name.endsWith('.json')) {
          const filePath = await join(backupDir, entry.name);
          try {
            const content = await readTextFile(filePath);
            const backupObj = JSON.parse(content);
            if (backupObj && backupObj.id && backupObj.snapshot) {
              list.push(backupObj);
            }
          } catch (e) {
            logger.error('Failed to parse backup file:', entry.name, e);
          }
        }
      }

      return list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } catch (err) {
      logger.error('Failed to read backups from native directory:', err);
      return [];
    }
  }

  const backups = await withStore<LocalBackup[]>(BACKUPS_STORE, 'readonly', (store) => store.getAll());
  const list = backups ?? [];
  return list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export async function writeBackup(backup: LocalBackup): Promise<void> {
  if (isTauri()) {
    try {
      const { appDataDir, join } = await import('@tauri-apps/api/path');
      const { exists, mkdir, writeTextFile } = await import('@tauri-apps/plugin-fs');

      const appDir = await appDataDir();
      const backupDir = await join(appDir, 'StudyFlow Backups');

      if (!(await exists(backupDir))) {
        await mkdir(backupDir, { recursive: true });
      }

      const filePath = await join(backupDir, `${backup.id}.json`);
      await writeTextFile(filePath, JSON.stringify(backup, null, 2));
      return;
    } catch (err) {
      logger.error('Failed to write backup file to native directory:', err);
      throw err;
    }
  }

  await withStore(BACKUPS_STORE, 'readwrite', (store) => {
    store.put(backup);
  });
}

export async function deleteBackup(backupId: string): Promise<void> {
  if (isTauri()) {
    try {
      const { appDataDir, join } = await import('@tauri-apps/api/path');
      const { exists, remove } = await import('@tauri-apps/plugin-fs');

      const appDir = await appDataDir();
      const backupDir = await join(appDir, 'StudyFlow Backups');
      const filePath = await join(backupDir, `${backupId}.json`);

      if (await exists(filePath)) {
        await remove(filePath);
      }
      return;
    } catch (err) {
      logger.error('Failed to delete backup file from native directory:', err);
      throw err;
    }
  }

  await withStore(BACKUPS_STORE, 'readwrite', (store) => {
    store.delete(backupId);
  });
}
