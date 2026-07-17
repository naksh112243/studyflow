import { useEffect, useRef } from 'react';
import { useEngineStore } from '@/store/engine-store';
import { logger } from '@/lib/logger';

export function useNativeNotifications() {
  const appState = useEngineStore(state => state.appState);
  const currentItem = useEngineStore(state => state.currentItem);
  const initialized = useEngineStore(state => state.initialized);

  const prevAppStateRef = useRef(appState);
  const prevItemIdRef = useRef<string | null>(null);
  const hasPermissionRef = useRef(false);
  const isFirstLoadRef = useRef(true);

  // Initialize and check permission
  useEffect(() => {
    const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;
    if (!isTauri) return;

    (async () => {
      try {
        const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
        let granted = await isPermissionGranted();
        if (!granted) {
          const permission = await requestPermission();
          granted = permission === 'granted';
        }
        hasPermissionRef.current = granted;
        logger.info(`Native notifications permission status: ${granted}`);
      } catch (err) {
        logger.error('Failed to initialize native notifications:', err);
      }
    })();
  }, []);

  // Set isFirstLoadRef to false after store finishes initializing
  useEffect(() => {
    if (initialized) {
      // Small timeout to skip the initial store load transition
      const timer = setTimeout(() => {
        isFirstLoadRef.current = false;
        prevAppStateRef.current = appState;
        prevItemIdRef.current = currentItem ? currentItem.id : null;
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [initialized]);

  // Track state transitions and fire notifications
  useEffect(() => {
    if (!initialized || isFirstLoadRef.current) {
      return;
    }

    const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;
    if (!isTauri) return;

    const prevAppState = prevAppStateRef.current;
    const prevItemId = prevItemIdRef.current;
    const currentItemId = currentItem ? currentItem.id : null;

    prevAppStateRef.current = appState;
    prevItemIdRef.current = currentItemId;

    // We only trigger notifications on actual changes
    if (appState !== prevAppState) {
      if (appState === 'break') {
        triggerNotification('Break Time! ☕', 'Time for a break! Take a deep breath and rest.');
      } else if (appState === 'study') {
        const subjectName = currentItem && 'subjectId' in currentItem ? currentItem.subjectId : null;
        const message = subjectName 
          ? `Ready to focus? Your study session for "${subjectName}" is starting.`
          : "Ready to focus? Your next study session is starting.";
        triggerNotification('Focus Session Started 🎯', message);
      } else if (appState === 'completed') {
        triggerNotification('Day Completed! 🎉', "Amazing job! You've finished all your study sessions for today.");
      }
    } else if (appState === 'study' && currentItemId !== prevItemId && currentItemId) {
      // Active study session changed to another one
      const subjectName = currentItem && 'subjectId' in currentItem ? currentItem.subjectId : null;
      if (subjectName) {
        triggerNotification('Next Study Session 📚', `Up next: Focus on "${subjectName}" now!`);
      }
    }
  }, [appState, currentItem, initialized]);

  async function triggerNotification(title: string, body: string) {
    try {
      const { sendNotification } = await import('@tauri-apps/plugin-notification');
      sendNotification({
        title,
        body,
      });
      logger.debug(`Sent native notification: ${title} - ${body}`);
    } catch (err) {
      logger.error('Failed to send native notification:', err);
    }
  }
}
