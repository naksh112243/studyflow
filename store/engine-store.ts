import { create } from 'zustand';
import {
  AppScreenState,
  EngineSession,
  EngineViewState,
  GenerateOptions,
  ScheduleItem,
  adjustTodaySchedule,
  buildOriginalTimetable,
  completeSession,
  deriveEngineViewState,
  formatRemainingTime,
  generateTodaySchedule,
  skipSession,
  validateSchedule,
  RecurrenceRule,
} from '@/lib/engine';
import { LocalStudyFlowRepository } from '@/repositories/local-studyflow.repository';
import { DEFAULT_SETTINGS, StudyFlowSettings, StudyFlowSnapshot, TimetableData, LocalBackup } from '@/storage/types';
import { logger } from '@/lib/logger';

export type { AppScreenState } from '@/lib/engine';

interface TimetableSubjectInput {
  id?: string;
  name: string;
  time: string;
  recurrenceRule?: RecurrenceRule;
  minimumDailyMinutes?: number;
  maximumDailyMinutes?: number;
}

interface TimetableOptionsInput {
  wakeTime: string;
  sleepTime: string;
}

interface EngineStoreState extends EngineViewState {
  initialized: boolean;
  errorMessage: string | null;
  activeTimetableId: string;
  setupTimetableId: string | null;
  timetables: TimetableData[];
  originalSessions: EngineSession[];
  items: ScheduleItem[];
  settings: StudyFlowSettings;
  options: GenerateOptions & { bedTime: string };
  remainingTime: string;
  backups: LocalBackup[];
  initialize: () => Promise<void>;
  refreshView: () => Promise<void>;
  setAppState: (state: AppScreenState) => void;
  setSetupTimetableId: (id: string | null) => void;
  cancelSetup: () => void;
  saveTimetable: (subjects: TimetableSubjectInput[], options: TimetableOptionsInput) => Promise<boolean>;
  createTimetable: (name: string, subjects: TimetableSubjectInput[], options: TimetableOptionsInput) => Promise<string>;
  switchTimetable: (id: string) => Promise<void>;
  deleteTimetable: (id: string) => Promise<void>;
  updateTimetableName: (id: string, name: string) => Promise<void>;
  refreshTodaySchedule: () => Promise<void>;
  adjustSchedule: () => Promise<void>;
  completeCurrentSession: () => Promise<void>;
  skipCurrentSession: () => Promise<void>;
  resetDaily: () => Promise<void>;
  setTheme: (theme: StudyFlowSettings['theme']) => Promise<void>;
  importWorkspace: (snapshot: StudyFlowSnapshot) => Promise<void>;
  loadBackups: () => Promise<void>;
  createLocalBackup: (name?: string) => Promise<void>;
  restoreLocalBackup: (backupId: string) => Promise<void>;
  deleteLocalBackup: (backupId: string) => Promise<void>;
}

const repository = new LocalStudyFlowRepository();

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function currentTime() {
  const date = new Date();
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function toOptions(settings: StudyFlowSettings): GenerateOptions & { bedTime: string } {
  return {
    wakeUpTime: settings.wakeTime,
    bedTime: settings.sleepTime,
    breakInterval: 60,
    breakDuration: 10,
    deepWorkMinDuration: 60,
  };
}

function createViewUpdate(
  items: ScheduleItem[],
  originalSessions: EngineSession[],
  now = currentTime(),
  appStateOverride?: AppScreenState
) {
  const viewState = deriveEngineViewState(items, originalSessions.length > 0, now);
  const appState = appStateOverride ?? viewState.appState;

  return {
    ...viewState,
    appState,
    remainingTime: formatRemainingTime(viewState.currentItem, now),
  };
}

async function persistAndSync(snapshot: Omit<StudyFlowSnapshot, 'id' | 'updatedAt'>) {
  const savedSnapshot = await repository.saveSnapshot(snapshot);
  return savedSnapshot;
}

function validateTimetableInput(subjects: TimetableSubjectInput[], options: TimetableOptionsInput) {
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

  if (!timePattern.test(options.wakeTime) || !timePattern.test(options.sleepTime)) {
    throw new Error('Wake time and sleep time must be valid times (HH:mm).');
  }

  if (subjects.length === 0) {
    throw new Error('Add at least one study session.');
  }

  const namesSeen = new Set<string>();

  for (const subject of subjects) {
    const trimmedName = subject.name.trim();
    if (!trimmedName) {
      throw new Error('Each study session needs a subject name.');
    }

    const lowerName = trimmedName.toLowerCase();
    if (namesSeen.has(lowerName)) {
      throw new Error(`Duplicate subject name "${trimmedName}" is not allowed.`);
    }
    namesSeen.add(lowerName);

    if (!timePattern.test(subject.time)) {
      throw new Error(`Subject "${trimmedName}" needs a valid start time.`);
    }

    const min = subject.minimumDailyMinutes;
    const max = subject.maximumDailyMinutes;

    if (Number.isNaN(min) || min === undefined || min === null) {
      throw new Error(`Minimum minutes for "${trimmedName}" must be a valid number.`);
    }
    if (!Number.isInteger(min)) {
      throw new Error(`Minimum minutes for "${trimmedName}" must be a whole number.`);
    }
    if (min < 0) {
      throw new Error(`Minimum minutes for "${trimmedName}" must be greater than or equal to 0.`);
    }
    if (min > 1440) {
      throw new Error(`Minimum minutes for "${trimmedName}" cannot exceed 1440.`);
    }

    if (Number.isNaN(max) || max === undefined || max === null) {
      throw new Error(`Maximum minutes for "${trimmedName}" must be a valid number.`);
    }
    if (!Number.isInteger(max)) {
      throw new Error(`Maximum minutes for "${trimmedName}" must be a whole number.`);
    }
    if (max <= 0) {
      throw new Error(`Maximum minutes for "${trimmedName}" must be greater than 0.`);
    }
    if (max > 1440) {
      throw new Error(`Maximum minutes for "${trimmedName}" cannot exceed 1440.`);
    }

    if (min > max) {
      throw new Error(`Minimum minutes (${min}) cannot exceed maximum minutes (${max}) for "${trimmedName}".`);
    }
  }
}

export const useEngineStore = create<EngineStoreState>((set, get) => ({
  initialized: false,
  errorMessage: null,
  activeTimetableId: '',
  setupTimetableId: null,
  timetables: [],
  originalSessions: [],
  items: [],
  settings: DEFAULT_SETTINGS,
  options: toOptions(DEFAULT_SETTINGS),
  remainingTime: '',

  // EngineViewState defaults
  appState: 'empty',
  currentItem: null,
  nextSession: null,
  progress: {
    completedSessions: 0,
    totalSessions: 0,
    percentage: 0,
    totalPlannedMinutes: 0,
    completedMinutes: 0,
    skippedMinutes: 0,
  },

  backups: [],

  setSetupTimetableId: (id) => set({ setupTimetableId: id }),

  cancelSetup: () => {
    const { items, originalSessions } = get();
    set({
      setupTimetableId: null,
      ...createViewUpdate(items, originalSessions, currentTime()),
    });
  },

  initialize: async () => {
    if (get().initialized) {
      return;
    }

    set({ appState: 'loading', errorMessage: null });

    try {
      const snapshot = await repository.getSnapshot();
      const activeId = snapshot.activeTimetableId;
      const timetablesList = snapshot.timetables;
      const target = timetablesList.find(t => t.id === activeId) || timetablesList[0];

      const settings = target.settings;
      let items = target.todayItems;
      let todayDate = target.todayDate;

      if (target.originalSessions.length > 0 && todayDate !== todayKey()) {
        const tz = settings.timezone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC');
        items = generateTodaySchedule(target.originalSessions, toOptions(settings), todayKey(), tz);
        todayDate = todayKey();
        target.todayItems = items;
        target.todayDate = todayDate;
        target.updatedAt = new Date().toISOString();

        await persistAndSync({
          activeTimetableId: activeId,
          timetables: timetablesList,
        });
      }

      set({
        initialized: true,
        errorMessage: null,
        activeTimetableId: activeId,
        timetables: timetablesList,
        settings,
        options: toOptions(settings),
        originalSessions: target.originalSessions,
        items,
        ...createViewUpdate(items, target.originalSessions, currentTime()),
      });

      try {
        await get().loadBackups();
      } catch (backupErr) {
        logger.error('Failed to load local backups during initialization:', backupErr);
      }
    } catch (error) {
      set({
        initialized: true,
        appState: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unable to load StudyFlow.',
      });
    }
  },

  refreshView: async () => {
    const { originalSessions, settings, items, initialized } = get();

    if (!initialized) {
      return;
    }

    if (originalSessions.length > 0) {
      const snapshot = await repository.getSnapshot();
      const target = snapshot.timetables.find(t => t.id === snapshot.activeTimetableId);

      if (target && target.todayDate !== todayKey()) {
        await get().refreshTodaySchedule();
        return;
      }
    }

    set({
      ...createViewUpdate(items, originalSessions, currentTime(), get().appState === 'setup' ? 'setup' : undefined),
      settings,
      options: toOptions(settings),
    });
  },

  setAppState: (appState) => {
    set({ appState });
  },

  saveTimetable: async (subjects, inputOptions) => {
    set({ errorMessage: null });

    try {
      validateTimetableInput(subjects, inputOptions);

      const activeTimetableId = get().activeTimetableId;
      const timetables = get().timetables;
      const target = timetables.find(t => t.id === activeTimetableId);
      if (!target) {
        throw new Error('No active timetable found.');
      }

      const settings: StudyFlowSettings = {
        ...target.settings,
        wakeTime: inputOptions.wakeTime,
        sleepTime: inputOptions.sleepTime,
      };
      const options = toOptions(settings);
      const originalSessions = buildOriginalTimetable(
        subjects.map((subject) => ({
          id: subject.id,
          subjectId: subject.name.trim(),
          startTime: subject.time,
          recurrenceRule: subject.recurrenceRule,
          minimumDailyMinutes: subject.minimumDailyMinutes,
          maximumDailyMinutes: subject.maximumDailyMinutes,
        })),
        { sleepTime: settings.sleepTime, deepWorkMinDuration: options.deepWorkMinDuration }
      );

      // Validate schedule generation against configured minimum daily targets
      const tz = settings.timezone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC');
      generateTodaySchedule(originalSessions, options, todayKey(), tz);

      const updatedTimetable: TimetableData = {
        ...target,
        settings,
        originalSessions,
        todayItems: [],
        todayDate: null,
        updatedAt: new Date().toISOString(),
      };

      const nextTimetables = timetables.map(t => t.id === activeTimetableId ? updatedTimetable : t);

      await persistAndSync({
        activeTimetableId,
        timetables: nextTimetables,
      });

      set({
        timetables: nextTimetables,
        settings,
        options,
        originalSessions,
        items: [],
        ...createViewUpdate([], originalSessions, currentTime(), 'loading'),
      });

      return true;
    } catch (error) {
      set({
        errorMessage: error instanceof Error ? error.message : 'Unable to save timetable.',
      });

      return false;
    }
  },

  createTimetable: async (name, subjects, inputOptions) => {
    set({ errorMessage: null });

    try {
      validateTimetableInput(subjects, inputOptions);

      const settings: StudyFlowSettings = {
        wakeTime: inputOptions.wakeTime,
        sleepTime: inputOptions.sleepTime,
        theme: get().settings.theme || 'natural',
        timezone: typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
      };
      const options = toOptions(settings);
      const originalSessions = buildOriginalTimetable(
        subjects.map((subject) => ({
          id: subject.id || crypto.randomUUID(),
          subjectId: subject.name.trim(),
          startTime: subject.time,
          recurrenceRule: subject.recurrenceRule,
          minimumDailyMinutes: subject.minimumDailyMinutes,
          maximumDailyMinutes: subject.maximumDailyMinutes,
        })),
        { sleepTime: settings.sleepTime, deepWorkMinDuration: options.deepWorkMinDuration }
      );

      // Validate schedule generation against configured minimum daily targets
      const tz = settings.timezone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC');
      generateTodaySchedule(originalSessions, options, todayKey(), tz);

      const newTimetable: TimetableData = {
        id: crypto.randomUUID(),
        name: name.trim() || 'New Timetable',
        settings,
        originalSessions,
        todayItems: [],
        todayDate: null,
        updatedAt: new Date().toISOString(),
      };

      const nextTimetables = [...get().timetables, newTimetable];

      await persistAndSync({
        activeTimetableId: newTimetable.id,
        timetables: nextTimetables,
      });

      set({
        activeTimetableId: newTimetable.id,
        timetables: nextTimetables,
        settings,
        options,
        originalSessions,
        items: [],
        ...createViewUpdate([], originalSessions, currentTime(), 'loading'),
      });

      return newTimetable.id;
    } catch (error) {
      set({
        errorMessage: error instanceof Error ? error.message : 'Unable to create timetable.',
      });
      return '';
    }
  },

  switchTimetable: async (id) => {
    const { timetables } = get();
    const target = timetables.find(t => t.id === id);
    if (!target) return;

    set({ appState: 'loading', errorMessage: null });

    try {
      const currentTimeStr = currentTime();
      const tz = target.settings.timezone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC');
      let items = target.todayItems;
      let todayDate = target.todayDate;

      if (target.originalSessions.length > 0 && todayDate !== todayKey()) {
        items = generateTodaySchedule(target.originalSessions, toOptions(target.settings), todayKey(), tz);
        todayDate = todayKey();
        target.todayItems = items;
        target.todayDate = todayDate;
        target.updatedAt = new Date().toISOString();
      }

      const nextTimetables = timetables.map(t => t.id === target.id ? { ...target, todayItems: items, todayDate } : t);

      await persistAndSync({
        activeTimetableId: id,
        timetables: nextTimetables,
      });

      set({
        activeTimetableId: id,
        timetables: nextTimetables,
        originalSessions: target.originalSessions,
        items,
        settings: target.settings,
        options: toOptions(target.settings),
        ...createViewUpdate(items, target.originalSessions, currentTimeStr),
      });
    } catch (error) {
      set({
        appState: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unable to switch timetable.',
      });
    }
  },

  deleteTimetable: async (id) => {
    const { timetables, activeTimetableId } = get();
    if (timetables.length <= 1) {
      return;
    }

    set({ appState: 'loading', errorMessage: null });

    try {
      const nextTimetables = timetables.filter(t => t.id !== id);
      let nextActiveId = activeTimetableId;
      if (activeTimetableId === id) {
        nextActiveId = nextTimetables[0].id;
      }

      const activeTarget = nextTimetables.find(t => t.id === nextActiveId)!;
      const currentTimeStr = currentTime();
      const tz = activeTarget.settings.timezone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC');
      let items = activeTarget.todayItems;
      let todayDate = activeTarget.todayDate;

      if (activeTarget.originalSessions.length > 0 && todayDate !== todayKey()) {
        items = generateTodaySchedule(activeTarget.originalSessions, toOptions(activeTarget.settings), todayKey(), tz);
        todayDate = todayKey();
        activeTarget.todayItems = items;
        activeTarget.todayDate = todayDate;
        activeTarget.updatedAt = new Date().toISOString();
      }

      await persistAndSync({
        activeTimetableId: nextActiveId,
        timetables: nextTimetables,
      });

      set({
        activeTimetableId: nextActiveId,
        timetables: nextTimetables,
        originalSessions: activeTarget.originalSessions,
        items,
        settings: activeTarget.settings,
        options: toOptions(activeTarget.settings),
        ...createViewUpdate(items, activeTarget.originalSessions, currentTimeStr),
      });
    } catch (error) {
      set({
        appState: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unable to delete timetable.',
      });
    }
  },

  updateTimetableName: async (id, name) => {
    const { timetables } = get();
    const nextTimetables = timetables.map(t => t.id === id ? { ...t, name: name.trim(), updatedAt: new Date().toISOString() } : t);

    set({ timetables: nextTimetables });

    await persistAndSync({
      activeTimetableId: get().activeTimetableId,
      timetables: nextTimetables,
    });
  },

  refreshTodaySchedule: async () => {
    const { originalSessions, settings, activeTimetableId, timetables } = get();

    if (originalSessions.length === 0) {
      set({
        items: [],
        ...createViewUpdate([], originalSessions, currentTime(), get().appState === 'setup' ? 'setup' : undefined),
      });
      return;
    }

    set({ appState: 'loading', errorMessage: null });

    try {
      const tz = settings.timezone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC');
      const items = generateTodaySchedule(originalSessions, toOptions(settings), todayKey(), tz);
      const validation = validateSchedule(items);

      if (!validation.valid) {
        throw new Error(validation.errors[0] ?? 'Generated schedule is invalid.');
      }

      const target = timetables.find(t => t.id === activeTimetableId);
      if (target) {
        target.todayItems = items;
        target.todayDate = todayKey();
        target.updatedAt = new Date().toISOString();
      }

      await persistAndSync({
        activeTimetableId,
        timetables,
      });

      set({
        items,
        ...createViewUpdate(items, originalSessions, currentTime(), get().appState === 'setup' ? 'setup' : undefined),
      });
    } catch (error) {
      set({
        appState: 'error',
        errorMessage: error instanceof Error ? error.message : "Unable to refresh today's schedule.",
      });
    }
  },

  adjustSchedule: async () => {
    const { items, options, originalSessions, settings, activeTimetableId, timetables } = get();
    set({ appState: 'loading', errorMessage: null });

    try {
      const adjustedItems = adjustTodaySchedule(items, { currentTime: currentTime() }, options);
      const validation = validateSchedule(adjustedItems);

      if (!validation.valid) {
        throw new Error(validation.errors[0] ?? 'Adjusted schedule is invalid.');
      }

      const target = timetables.find(t => t.id === activeTimetableId);
      if (target) {
        target.todayItems = adjustedItems;
        target.todayDate = todayKey();
        target.updatedAt = new Date().toISOString();
      }

      await persistAndSync({
        activeTimetableId,
        timetables,
      });

      set({
        items: adjustedItems,
        ...createViewUpdate(adjustedItems, originalSessions, currentTime()),
      });
    } catch (error) {
      set({
        appState: 'error',
        errorMessage: error instanceof Error ? error.message : "Unable to update today's schedule.",
      });
    }
  },

  completeCurrentSession: async () => {
    const { currentItem, items, options, originalSessions, settings, activeTimetableId, timetables } = get();

    if (!currentItem || !('status' in currentItem)) {
      return;
    }

    set({ appState: 'loading', errorMessage: null });

    try {
      const updatedItems = completeSession(items, currentItem.id, currentTime(), options);

      const target = timetables.find(t => t.id === activeTimetableId);
      if (target) {
        target.todayItems = updatedItems;
        target.todayDate = todayKey();
        target.updatedAt = new Date().toISOString();
      }

      await persistAndSync({
        activeTimetableId,
        timetables,
      });

      set({
        items: updatedItems,
        ...createViewUpdate(updatedItems, originalSessions, currentTime()),
      });
    } catch (error) {
      set({
        appState: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unable to complete this session.',
      });
    }
  },

  skipCurrentSession: async () => {
    const { currentItem, items, options, originalSessions, settings, activeTimetableId, timetables } = get();

    if (!currentItem || !('status' in currentItem)) {
      return;
    }

    set({ appState: 'loading', errorMessage: null });

    try {
      const updatedItems = skipSession(items, currentItem.id, currentTime(), options);

      const target = timetables.find(t => t.id === activeTimetableId);
      if (target) {
        target.todayItems = updatedItems;
        target.todayDate = todayKey();
        target.updatedAt = new Date().toISOString();
      }

      await persistAndSync({
        activeTimetableId,
        timetables,
      });

      set({
        items: updatedItems,
        ...createViewUpdate(updatedItems, originalSessions, currentTime()),
      });
    } catch (error) {
      set({
        appState: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unable to skip this session.',
      });
    }
  },

  resetDaily: async () => {
    await get().refreshTodaySchedule();
  },

  setTheme: async (theme) => {
    const { originalSessions, items, settings, activeTimetableId, timetables } = get();
    const nextSettings = { ...settings, theme };

    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('studyflow-theme', theme);
      }

      const target = timetables.find(t => t.id === activeTimetableId);
      if (target) {
        const updatedTimetable = {
          ...target,
          settings: nextSettings,
          updatedAt: new Date().toISOString(),
        };
        const nextTimetables = timetables.map(t => t.id === activeTimetableId ? updatedTimetable : t);

        await persistAndSync({
          activeTimetableId,
          timetables: nextTimetables,
        });

        set({
          timetables: nextTimetables,
          settings: nextSettings,
          options: toOptions(nextSettings),
        });
      }
    } catch (error) {
      set({
        appState: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unable to save appearance preference.',
      });
    }
  },

  importWorkspace: async (snapshot: StudyFlowSnapshot) => {
    set({ appState: 'loading', errorMessage: null });
    try {
      const savedSnapshot = await persistAndSync(snapshot);

      const activeId = savedSnapshot.activeTimetableId;
      const timetablesList = savedSnapshot.timetables;
      const target = timetablesList.find(t => t.id === activeId) || timetablesList[0];
      if (!target) {
        throw new Error('Imported snapshot contains no timetables.');
      }

      const settings = target.settings;
      const originalSessions = target.originalSessions;
      let items = target.todayItems;
      let todayDate = target.todayDate;

      if (originalSessions.length > 0 && todayDate !== todayKey()) {
        const tz = settings.timezone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC');
        items = generateTodaySchedule(originalSessions, toOptions(settings), todayKey(), tz);
        todayDate = todayKey();
        target.todayItems = items;
        target.todayDate = todayDate;
        target.updatedAt = new Date().toISOString();

        await persistAndSync({
          activeTimetableId: activeId,
          timetables: timetablesList,
        });
      }

      set({
        activeTimetableId: activeId,
        timetables: timetablesList,
        settings,
        options: toOptions(settings),
        originalSessions,
        items,
        ...createViewUpdate(items, originalSessions, currentTime()),
        appState: 'empty',
      });
    } catch (error) {
      set({
        appState: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unable to import data.',
      });
      throw error;
    }
  },
  loadBackups: async () => {
    try {
      const list = await repository.getBackups();
      set({ backups: list });
    } catch (err) {
      logger.error('Failed to load local backups:', err);
    }
  },
  createLocalBackup: async (name?: string) => {
    try {
      const activeTimetableId = get().activeTimetableId;
      const timetables = get().timetables;
      const snapshot: StudyFlowSnapshot = {
        id: 'default',
        activeTimetableId,
        timetables,
        updatedAt: new Date().toISOString(),
      };
      
      const timestampStr = new Date().toLocaleString();
      const backupName = name?.trim() || `Backup — ${timestampStr}`;
      
      const backup: LocalBackup = {
        id: crypto.randomUUID(),
        name: backupName,
        timestamp: new Date().toISOString(),
        snapshot,
      };
      
      await repository.saveBackup(backup);
      await get().loadBackups();
    } catch (err) {
      logger.error('Failed to create local backup:', err);
      throw err;
    }
  },
  restoreLocalBackup: async (backupId: string) => {
    const backup = get().backups.find(b => b.id === backupId);
    if (!backup) {
      throw new Error('Local backup not found.');
    }
    await get().importWorkspace(backup.snapshot);
  },
  deleteLocalBackup: async (backupId: string) => {
    try {
      await repository.deleteBackup(backupId);
      await get().loadBackups();
    } catch (err) {
      logger.error('Failed to delete backup:', err);
      throw err;
    }
  },
}));
