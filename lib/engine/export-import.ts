import { StudyFlowSnapshot, TimetableData, StudyFlowSettings } from '@/storage/types';
import { EngineSession, ScheduleItem } from './types';

export interface ExportMetadata {
  app: string;
  appVersion: string;
  schemaVersion: number;
  exportTimestamp: string;
}

export interface ExportPayload {
  metadata: ExportMetadata;
  data: Omit<StudyFlowSnapshot, 'id'> & { id?: 'default' };
}

const CURRENT_SCHEMA_VERSION = 1;
const CURRENT_APP_VERSION = '1.0.0';

/**
 * Serializes a StudyFlowSnapshot into an exported JSON string.
 */
export function serializeExport(snapshot: StudyFlowSnapshot): string {
  const payload: ExportPayload = {
    metadata: {
      app: 'StudyFlow',
      appVersion: CURRENT_APP_VERSION,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportTimestamp: new Date().toISOString(),
    },
    data: {
      activeTimetableId: snapshot.activeTimetableId,
      timetables: snapshot.timetables,
      updatedAt: snapshot.updatedAt,
    },
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Validates untrusted input object to prevent prototype pollution and malformed payloads.
 */
function isSafeObject(obj: any): boolean {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return false;
  }
  // Prevent prototype pollution or malicious getters
  const keys = Object.getOwnPropertyNames(obj);
  for (const key of keys) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return false;
    }
  }
  return true;
}

function isValidTime(time: any): boolean {
  if (typeof time !== 'string') return false;
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  return timePattern.test(time);
}

function isValidDate(dateStr: any): boolean {
  if (typeof dateStr !== 'string') return false;
  // Basic date match: YYYY-MM-DD
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  return datePattern.test(dateStr) && !isNaN(Date.parse(dateStr));
}

/**
 * Rigorously validates an exported JSON string and returns the parsed snapshot or error message.
 */
export function validateAndParseImport(jsonString: string): 
  { success: true; snapshot: StudyFlowSnapshot; metadata: ExportMetadata } | { success: false; error: string } {
  
  if (!jsonString || typeof jsonString !== 'string') {
    return { success: false, error: 'Empty or invalid import file.' };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    return { success: false, error: 'Malformed JSON payload. The file is corrupted or not a valid JSON.' };
  }

  if (!isSafeObject(parsed)) {
    return { success: false, error: 'Invalid file format. Import rejected.' };
  }

  // 1. Validate Metadata
  const metadata = parsed.metadata;
  if (!isSafeObject(metadata)) {
    return { success: false, error: 'Missing export metadata structure.' };
  }

  if (metadata.app !== 'StudyFlow') {
    return { success: false, error: 'This file does not belong to the StudyFlow application.' };
  }

  const schemaVersion = metadata.schemaVersion;
  if (typeof schemaVersion !== 'number') {
    return { success: false, error: 'Metadata is missing a valid schema version.' };
  }

  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    return { 
      success: false, 
      error: `Unsupported future schema version (${schemaVersion}). Please update your StudyFlow application.` 
    };
  }

  if (typeof metadata.appVersion !== 'string' || !metadata.appVersion) {
    return { success: false, error: 'Metadata is missing a valid app version.' };
  }

  if (typeof metadata.exportTimestamp !== 'string' || !metadata.exportTimestamp) {
    return { success: false, error: 'Metadata is missing an export timestamp.' };
  }

  // 2. Validate Data Snapshot
  const data = parsed.data;
  if (!isSafeObject(data)) {
    return { success: false, error: 'Missing export data workspace payload.' };
  }

  if (typeof data.activeTimetableId !== 'string' || !data.activeTimetableId.trim()) {
    return { success: false, error: 'Workspace is missing an active timetable identifier.' };
  }

  const timetables = data.timetables;
  if (!Array.isArray(timetables) || timetables.length === 0) {
    return { success: false, error: 'Workspace must contain at least one timetable.' };
  }

  const timetableIds = new Set<string>();

  for (let tIdx = 0; tIdx < timetables.length; tIdx++) {
    const t = timetables[tIdx];
    if (!isSafeObject(t)) {
      return { success: false, error: `Timetable at index ${tIdx} is corrupted or not a valid structure.` };
    }

    if (typeof t.id !== 'string' || !t.id.trim()) {
      return { success: false, error: `Timetable at index ${tIdx} is missing a unique identifier.` };
    }

    if (timetableIds.has(t.id)) {
      return { success: false, error: `Duplicate timetable ID detected: "${t.id}".` };
    }
    timetableIds.add(t.id);

    if (typeof t.name !== 'string' || !t.name.trim()) {
      return { success: false, error: `Timetable "${t.id}" is missing a valid name.` };
    }

    // Validate settings
    const settings = t.settings;
    if (!isSafeObject(settings)) {
      return { success: false, error: `Timetable "${t.name}" is missing settings.` };
    }

    if (!isValidTime(settings.wakeTime)) {
      return { success: false, error: `Timetable "${t.name}" has an invalid wakeTime: "${settings.wakeTime}".` };
    }

    if (!isValidTime(settings.sleepTime)) {
      return { success: false, error: `Timetable "${t.name}" has an invalid sleepTime: "${settings.sleepTime}".` };
    }

    if (settings.theme !== 'light' && settings.theme !== 'dark' && settings.theme !== 'natural') {
      return { success: false, error: `Timetable "${t.name}" has an unsupported theme: "${settings.theme}".` };
    }

    if (typeof settings.timezone !== 'string' || !settings.timezone) {
      return { success: false, error: `Timetable "${t.name}" is missing a timezone configuration.` };
    }

    // Validate originalSessions
    const originalSessions = t.originalSessions;
    if (!Array.isArray(originalSessions)) {
      return { success: false, error: `Timetable "${t.name}" contains an invalid sessions list.` };
    }

    const sessionIds = new Set<string>();

    for (let sIdx = 0; sIdx < originalSessions.length; sIdx++) {
      const s = originalSessions[sIdx];
      if (!isSafeObject(s)) {
        return { success: false, error: `Session at index ${sIdx} in timetable "${t.name}" is corrupted.` };
      }

      if (typeof s.id !== 'string' || !s.id.trim()) {
        return { success: false, error: `Session at index ${sIdx} in timetable "${t.name}" is missing a unique identifier.` };
      }

      if (sessionIds.has(s.id)) {
        return { success: false, error: `Duplicate session ID "${s.id}" detected in timetable "${t.name}".` };
      }
      sessionIds.add(s.id);

      if (s.subjectId !== null && typeof s.subjectId !== 'string') {
        return { success: false, error: `Session "${s.id}" in timetable "${t.name}" has an invalid subject identifier.` };
      }

      if (s.startTime !== null && !isValidTime(s.startTime)) {
        return { success: false, error: `Session "${s.id}" in timetable "${t.name}" has an invalid start time.` };
      }

      if (s.endTime !== null && !isValidTime(s.endTime)) {
        return { success: false, error: `Session "${s.id}" in timetable "${t.name}" has an invalid end time.` };
      }

      if (typeof s.durationMinutes !== 'number' || s.durationMinutes < 0 || !Number.isInteger(s.durationMinutes)) {
        return { success: false, error: `Session "${s.id}" in timetable "${t.name}" has an invalid duration minutes.` };
      }

      if (s.status !== 'planned' && s.status !== 'completed' && s.status !== 'skipped') {
        return { success: false, error: `Session "${s.id}" in timetable "${t.name}" has an unsupported status: "${s.status}".` };
      }

      if (s.minimumDailyMinutes !== undefined && s.minimumDailyMinutes !== null) {
        const min = s.minimumDailyMinutes;
        if (typeof min !== 'number' || Number.isNaN(min) || min < 0 || min > 1440 || !Number.isInteger(min)) {
          return { success: false, error: `Session "${s.id}" in timetable "${t.name}" has an invalid minimum daily minutes (must be a whole number between 0 and 1440).` };
        }
      }

      if (s.maximumDailyMinutes !== undefined && s.maximumDailyMinutes !== null) {
        const max = s.maximumDailyMinutes;
        if (typeof max !== 'number' || Number.isNaN(max) || max <= 0 || max > 1440 || !Number.isInteger(max)) {
          return { success: false, error: `Session "${s.id}" in timetable "${t.name}" has an invalid maximum daily minutes (must be a whole number between 1 and 1440).` };
        }
      }

      if (
        s.minimumDailyMinutes !== undefined && s.minimumDailyMinutes !== null &&
        s.maximumDailyMinutes !== undefined && s.maximumDailyMinutes !== null &&
        s.minimumDailyMinutes > s.maximumDailyMinutes
      ) {
        return { success: false, error: `Session "${s.id}" in timetable "${t.name}" has minimum daily minutes (${s.minimumDailyMinutes}) exceeding maximum daily minutes (${s.maximumDailyMinutes}).` };
      }

      if (s.recurrenceRule !== undefined) {
        const rule = s.recurrenceRule;
        if (!isSafeObject(rule)) {
          return { success: false, error: `Session "${s.id}" in timetable "${t.name}" has a corrupted recurrence rule.` };
        }
        if (typeof rule.id !== 'string' || !rule.id.trim()) {
          return { success: false, error: `Recurrence rule in session "${s.id}" in timetable "${t.name}" is missing an ID.` };
        }
        if (rule.frequency !== 'once' && rule.frequency !== 'daily' && rule.frequency !== 'weekly' && rule.frequency !== 'custom_weeks' && rule.frequency !== 'weekdays') {
          return { success: false, error: `Recurrence rule in session "${s.id}" in timetable "${t.name}" has an invalid frequency: "${rule.frequency}".` };
        }
        if (rule.daysOfWeek !== undefined && (!Array.isArray(rule.daysOfWeek) || rule.daysOfWeek.some((d: any) => typeof d !== 'number' || d < 0 || d > 6))) {
          return { success: false, error: `Recurrence rule in session "${s.id}" in timetable "${t.name}" has an invalid daysOfWeek array.` };
        }
        if (rule.interval !== undefined && (typeof rule.interval !== 'number' || rule.interval <= 0 || !Number.isInteger(rule.interval))) {
          return { success: false, error: `Recurrence rule in session "${s.id}" in timetable "${t.name}" has an invalid interval.` };
        }
        if (rule.startDate !== undefined && typeof rule.startDate !== 'string') {
          return { success: false, error: `Recurrence rule in session "${s.id}" in timetable "${t.name}" has an invalid startDate.` };
        }
        if (rule.until !== undefined && typeof rule.until !== 'string') {
          return { success: false, error: `Recurrence rule in session "${s.id}" in timetable "${t.name}" has an invalid until date.` };
        }
      }

      if (s.exceptions !== undefined) {
        if (!Array.isArray(s.exceptions)) {
          return { success: false, error: `Session "${s.id}" in timetable "${t.name}" contains an invalid exceptions list.` };
        }
        for (let eIdx = 0; eIdx < s.exceptions.length; eIdx++) {
          const ex = s.exceptions[eIdx];
          if (!isSafeObject(ex)) {
            return { success: false, error: `Exception at index ${eIdx} in session "${s.id}" is corrupted.` };
          }
          if (typeof ex.date !== 'string') {
            return { success: false, error: `Exception at index ${eIdx} in session "${s.id}" is missing a valid date.` };
          }
          if (typeof ex.isSkipped !== 'boolean') {
            return { success: false, error: `Exception at index ${eIdx} in session "${s.id}" is missing isSkipped flag.` };
          }
          if (ex.adjustedStartTime !== undefined && ex.adjustedStartTime !== null && !isValidTime(ex.adjustedStartTime)) {
            return { success: false, error: `Exception at index ${eIdx} in session "${s.id}" has an invalid adjusted start time.` };
          }
        }
      }
    }

    // Validate todayItems
    const todayItems = t.todayItems;
    if (!Array.isArray(todayItems)) {
      return { success: false, error: `Timetable "${t.name}" contains an invalid todayItems schedule.` };
    }

    const todayItemIds = new Set<string>();

    for (let itemIdx = 0; itemIdx < todayItems.length; itemIdx++) {
      const item = todayItems[itemIdx];
      if (!isSafeObject(item)) {
        return { success: false, error: `Schedule item at index ${itemIdx} in timetable "${t.name}" is corrupted.` };
      }

      if (typeof item.id !== 'string' || !item.id.trim()) {
        return { success: false, error: `Schedule item at index ${itemIdx} in timetable "${t.name}" is missing an ID.` };
      }

      if (todayItemIds.has(item.id)) {
        return { success: false, error: `Duplicate schedule item ID "${item.id}" in active schedule for timetable "${t.name}".` };
      }
      todayItemIds.add(item.id);

      if ('isBreak' in item) {
        if (item.isBreak !== true) {
          return { success: false, error: `Break item "${item.id}" has an invalid isBreak property.` };
        }
        if (!isValidTime(item.startTime) || !isValidTime(item.endTime)) {
          return { success: false, error: `Break item "${item.id}" has invalid timing properties.` };
        }
        if (typeof item.durationMinutes !== 'number' || item.durationMinutes < 0) {
          return { success: false, error: `Break item "${item.id}" has an invalid duration.` };
        }
      } else if ('isFreeTime' in item) {
        if (item.isFreeTime !== true) {
          return { success: false, error: `Free time item "${item.id}" has an invalid isFreeTime property.` };
        }
        if (!isValidTime(item.startTime) || !isValidTime(item.endTime)) {
          return { success: false, error: `Free time item "${item.id}" has invalid timing properties.` };
        }
        if (typeof item.durationMinutes !== 'number' || item.durationMinutes < 0) {
          return { success: false, error: `Free time item "${item.id}" has an invalid duration.` };
        }
      } else {
        // Must be a standard EngineSession item
        if (item.status !== 'planned' && item.status !== 'completed' && item.status !== 'skipped') {
          return { success: false, error: `Session item "${item.id}" has an invalid status: "${item.status}".` };
        }
        if (item.startTime !== null && !isValidTime(item.startTime)) {
          return { success: false, error: `Session item "${item.id}" has an invalid start time.` };
        }
        if (item.endTime !== null && !isValidTime(item.endTime)) {
          return { success: false, error: `Session item "${item.id}" has an invalid end time.` };
        }
        if (typeof item.durationMinutes !== 'number' || item.durationMinutes < 0) {
          return { success: false, error: `Session item "${item.id}" has an invalid duration minutes.` };
        }
      }
    }

    if (t.todayDate !== null && typeof t.todayDate !== 'string') {
      return { success: false, error: `Timetable "${t.name}" has an invalid todayDate configuration.` };
    }

    if (typeof t.updatedAt !== 'string' || !t.updatedAt) {
      return { success: false, error: `Timetable "${t.name}" is missing a last updated timestamp.` };
    }
  }

  // Ensure activeTimetableId exists in the loaded timetables
  if (!timetableIds.has(data.activeTimetableId)) {
    return { 
      success: false, 
      error: `Active timetable identifier "${data.activeTimetableId}" does not exist in the loaded timetables list.` 
    };
  }

  // Build proper StudyFlowSnapshot output
  const snapshot: StudyFlowSnapshot = {
    id: 'default',
    activeTimetableId: data.activeTimetableId,
    timetables: timetables as TimetableData[],
    updatedAt: data.updatedAt || new Date().toISOString(),
  };

  return {
    success: true,
    snapshot,
    metadata,
  };
}
