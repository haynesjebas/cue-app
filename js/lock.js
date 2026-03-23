/**
 * lock.js — Re-exported from lock.html inline script.
 * This file exists as a module endpoint for any screens
 * that need to programmatically trigger the lock screen.
 */

/**
 * Trigger lock screen if app lock is enabled.
 * Call from any screen on app visibility change.
 */
export function triggerLockIfEnabled() {
  const lockEnabled = localStorage.getItem('cue_lock_enabled') === 'true';
  const unlocked    = sessionStorage.getItem('cue_unlocked') === 'true';

  if (lockEnabled && !unlocked) {
    window.location.replace('/lock.html');
  }
}

/**
 * Clear the session unlock state.
 * Called when the app goes to background (optional, for extra security).
 */
export function clearUnlockState() {
  sessionStorage.removeItem('cue_unlocked');
}

// ── Auto-lock on page hide (optional) ─────────────────────
const AUTO_LOCK_ON_HIDE = false; // set to true to lock when app is backgrounded

if (AUTO_LOCK_ON_HIDE) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      clearUnlockState();
    }
  });
}
