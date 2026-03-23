/**
 * auth.js — ALL Supabase authentication calls live here.
 * No screen file ever calls supabase.auth directly.
 * To swap auth provider: change this file only.
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ─── CONFIG ───────────────────────────────────────────────
// Replace these with your actual Supabase project values
const SUPABASE_URL = 'https://pijzedduvfptlkpevpco.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable__cr_cNELXxSYfp4lX_-2jQ_jULPthlD';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── SESSION ──────────────────────────────────────────────

/**
 * Get the currently authenticated user.
 * Returns null if no session exists.
 */
export async function getUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) return null;
  return user;
}

/**
 * Get the current session object.
 */
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/**
 * Subscribe to auth state changes.
 * callback(event, session) is called whenever auth state changes.
 */
export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}

// ─── EMAIL / PASSWORD ─────────────────────────────────────

/**
 * Sign in with email + password.
 * Returns { user, error }.
 */
export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  return { user: data?.user ?? null, error };
}

/**
 * Sign up a new user with email + password.
 * Returns { user, error }.
 */
export async function signUpWithEmail(email, password, name) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      data: {
        name: name ?? '',
        avatar_initials: getInitials(name ?? email),
      },
    },
  });
  return { user: data?.user ?? null, error };
}

/**
 * Send password reset email.
 */
export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
    { redirectTo: `${window.location.origin}/login.html` }
  );
  return { error };
}

/**
 * Update user password (when already authenticated).
 */
export async function updatePassword(newPassword) {
  const { data, error } = await supabase.auth.updateUser({ password: newPassword });
  return { user: data?.user ?? null, error };
}

// ─── OAUTH ────────────────────────────────────────────────

/**
 * Sign in with Google.
 * Initiates OAuth redirect flow.
 */
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/habits.html`,
    },
  });
  return { error };
}

/**
 * Sign in with Apple.
 * Initiates OAuth redirect flow.
 */
export async function signInWithApple() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: {
      redirectTo: `${window.location.origin}/habits.html`,
    },
  });
  return { error };
}

// ─── SIGN OUT ─────────────────────────────────────────────

/**
 * Sign the current user out.
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (!error) {
    // Clear any locally stored PIN / session data
    localStorage.removeItem('cue_pin_hash');
    localStorage.removeItem('cue_lock_enabled');
    localStorage.removeItem('cue_biometric_enabled');
    window.location.href = '/login.html';
  }
  return { error };
}

// ─── USER PROFILE ─────────────────────────────────────────

/**
 * Update authenticated user's display name.
 */
export async function updateUserName(name) {
  const { data, error } = await supabase.auth.updateUser({
    data: {
      name,
      avatar_initials: getInitials(name),
    },
  });
  return { user: data?.user ?? null, error };
}

/**
 * Update authenticated user's email.
 */
export async function updateUserEmail(email) {
  const { data, error } = await supabase.auth.updateUser({
    email: email.trim().toLowerCase(),
  });
  return { user: data?.user ?? null, error };
}

// ─── AUTH GUARD ───────────────────────────────────────────

/**
 * Check auth and redirect if not authenticated.
 * Call at the top of each protected page.
 * Returns the authenticated user or null (after redirect).
 */
export async function requireAuth(redirectTo = '/login.html') {
  const user = await getUser();
  if (!user) {
    window.location.href = redirectTo;
    return null;
  }
  return user;
}

/**
 * Check if app lock is enabled and redirect to lock screen.
 * Call after requireAuth on each protected page.
 */
export function checkLock() {
  const lockEnabled = localStorage.getItem('cue_lock_enabled') === 'true';
  const unlocked = sessionStorage.getItem('cue_unlocked') === 'true';
  if (lockEnabled && !unlocked) {
    window.location.href = '/lock.html';
    return false;
  }
  return true;
}

// ─── HELPERS ──────────────────────────────────────────────

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export { getInitials };
