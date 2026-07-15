import fs from 'fs';
import path from 'path';
import { StudyFlowSnapshot } from '@/storage/types';

const DB_DIR = path.join(process.cwd(), '.data');
const DB_FILE = path.join(DB_DIR, 'cloud_db.json');

export interface CloudUser {
  id: string;
  email: string;
  name?: string;
  createdAt: string;
}

export interface CloudSnapshot {
  userId: string;
  snapshot: StudyFlowSnapshot;
  updatedAt: string;
}

interface DbSchema {
  users: CloudUser[];
  snapshots: CloudSnapshot[];
}

const defaultDb: DbSchema = {
  users: [],
  snapshots: [],
};

function ensureDbFile() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2), 'utf8');
  }
}

function readDb(): DbSchema {
  try {
    ensureDbFile();
    const content = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.error('Error reading cloud_db:', err);
    return defaultDb;
  }
}

function writeDb(data: DbSchema) {
  try {
    ensureDbFile();
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing cloud_db:', err);
  }
}

export class CloudDb {
  static getUsers(): CloudUser[] {
    return readDb().users;
  }

  static findUserByEmail(email: string): CloudUser | null {
    const db = readDb();
    return db.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  static findUserById(id: string): CloudUser | null {
    const db = readDb();
    return db.users.find((u) => u.id === id) ?? null;
  }

  static createUser(email: string, name?: string): CloudUser {
    const db = readDb();
    const existing = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      return existing;
    }

    const newUser: CloudUser = {
      id: 'usr_' + Math.random().toString(36).substring(2, 11),
      email,
      name,
      createdAt: new Date().toISOString(),
    };

    db.users.push(newUser);
    writeDb(db);
    return newUser;
  }

  static getSnapshot(userId: string): StudyFlowSnapshot | null {
    const db = readDb();
    const found = db.snapshots.find((s) => s.userId === userId);
    return found ? found.snapshot : null;
  }

  static saveSnapshot(userId: string, snapshot: StudyFlowSnapshot): void {
    const db = readDb();
    const index = db.snapshots.findIndex((s) => s.userId === userId);

    const newRecord: CloudSnapshot = {
      userId,
      snapshot,
      updatedAt: new Date().toISOString(),
    };

    if (index >= 0) {
      db.snapshots[index] = newRecord;
    } else {
      db.snapshots.push(newRecord);
    }

    writeDb(db);
  }
}
