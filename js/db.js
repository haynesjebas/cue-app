/**
 * db.js — ALL Supabase database calls live here.
 * No screen file ever calls supabase directly.
 * To swap the database: change this file only.
 */

import { supabase } from './auth.js';

// ─── USERS ────────────────────────────────────────────────

/**
 * Upsert the user profile row after sign-in / sign-up.
 */
export async function upsertUserProfile(user) {
  const initials = user.user_metadata?.avatar_initials
    || user.user_metadata?.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    || user.email?.[0]?.toUpperCase()
    || '?';

  const { error } = await supabase.from('users').upsert({
    id: user.id,
    email: user.email,
    name: user.user_metadata?.name ?? user.email,
    avatar_initials: initials,
  }, { onConflict: 'id' });

  return { error };
}

/**
 * Fetch user profile row by id.
 * Auto-creates the row if it doesn't exist (e.g. after OAuth redirect).
 */
export async function getUserProfile(userId) {
  let { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (!data) {
    const { data: authData } = await supabase.auth.getUser();
    if (authData?.user && authData.user.id === userId) {
      await upsertUserProfile(authData.user);
      const retry = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
      data = retry.data;
      error = retry.error;
    }
  }

  return { profile: data, error };
}

/**
 * Update the user's name in the users table.
 */
export async function updateProfileName(userId, name) {
  const initials = name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const { error } = await supabase
    .from('users')
    .update({ name, avatar_initials: initials })
    .eq('id', userId);
  return { error };
}

// ─── HABITS ───────────────────────────────────────────────

/**
 * Fetch all habits for a user, ordered by creation date.
 * Returns { habits: [], error }
 */
export async function getHabits(userId) {
  const { data, error } = await supabase
    .from('habits')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  return { habits: data ?? [], error };
}

/**
 * Create a new habit.
 */
export async function createHabit(userId, { name, type, target_count, days_of_week }) {
  const { data, error } = await supabase
    .from('habits')
    .insert({
      user_id: userId,
      name,
      type: type ?? 'daily',
      target_count: target_count ?? 1,
      days_of_week: days_of_week ?? [],
    })
    .select()
    .single();
  return { habit: data, error };
}

/**
 * Update an existing habit.
 */
export async function updateHabit(habitId, updates) {
  const { data, error } = await supabase
    .from('habits')
    .update(updates)
    .eq('id', habitId)
    .select()
    .single();
  return { habit: data, error };
}

/**
 * Delete a habit and all associated logs.
 */
export async function deleteHabit(habitId) {
  // Delete logs first (no cascade in schema)
  await supabase.from('habit_logs').delete().eq('habit_id', habitId);
  const { error } = await supabase.from('habits').delete().eq('id', habitId);
  return { error };
}

// ─── HABIT LOGS ───────────────────────────────────────────

/**
 * Get all logs for a specific user within a date range.
 * Dates are ISO strings: '2025-01-01'
 */
export async function getHabitLogs(userId, startDate, endDate) {
  const { data, error } = await supabase
    .from('habit_logs')
    .select('*')
    .eq('user_id', userId)
    .gte('completed_date', startDate)
    .lte('completed_date', endDate)
    .order('completed_date', { ascending: true });
  return { logs: data ?? [], error };
}

/**
 * Get all logs for a specific habit.
 */
export async function getLogsForHabit(habitId) {
  const { data, error } = await supabase
    .from('habit_logs')
    .select('*')
    .eq('habit_id', habitId)
    .order('completed_date', { ascending: false });
  return { logs: data ?? [], error };
}

/**
 * Log a habit completion for today.
 * Returns { log, error }.
 */
export async function logHabitCompletion(habitId, userId, date) {
  const completedDate = date ?? new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('habit_logs')
    .insert({ habit_id: habitId, user_id: userId, completed_date: completedDate })
    .select()
    .single();
  return { log: data, error };
}

/**
 * Remove a habit log (un-tick a habit for a given date).
 */
export async function removeHabitLog(habitId, userId, date) {
  const { error } = await supabase
    .from('habit_logs')
    .delete()
    .eq('habit_id', habitId)
    .eq('user_id', userId)
    .eq('completed_date', date);
  return { error };
}

/**
 * Check if a habit is completed for a given date.
 */
export async function isHabitCompleted(habitId, userId, date) {
  const { data } = await supabase
    .from('habit_logs')
    .select('id')
    .eq('habit_id', habitId)
    .eq('user_id', userId)
    .eq('completed_date', date)
    .maybeSingle();
  return !!data;
}

/**
 * Get current streak for a habit (consecutive days from today going back).
 */
export async function getHabitStreak(habitId, userId) {
  const { data } = await supabase
    .from('habit_logs')
    .select('completed_date')
    .eq('habit_id', habitId)
    .eq('user_id', userId)
    .order('completed_date', { ascending: false });

  if (!data || data.length === 0) return 0;

  const dates = data.map(r => r.completed_date);
  let streak = 0;
  let current = new Date();
  current.setHours(0, 0, 0, 0);

  for (let i = 0; i < 365; i++) {
    const dateStr = current.toISOString().split('T')[0];
    if (dates.includes(dateStr)) {
      streak++;
    } else if (i > 0) {
      break;
    }
    current.setDate(current.getDate() - 1);
  }

  return streak;
}

/**
 * Get habit completion data for a given month.
 * Returns an array of { date, count } objects.
 */
export async function getMonthlyCompletionData(userId, year, month) {
  // month is 1-indexed
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate   = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`;

  const { logs } = await getHabitLogs(userId, startDate, endDate);

  // Group by date
  const grouped = {};
  for (const log of logs) {
    grouped[log.completed_date] = (grouped[log.completed_date] || 0) + 1;
  }

  return Object.entries(grouped).map(([date, count]) => ({ date, count }));
}

// ─── MOMENTS ─────────────────────────────────────────────

/**
 * Fetch all moments for a user, newest first.
 */
export async function getMoments(userId) {
  const { data, error } = await supabase
    .from('moments')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false });
  return { moments: data ?? [], error };
}

/**
 * Fetch moments for a specific month.
 */
export async function getMomentsByMonth(userId, year, month) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate   = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`;

  const { data, error } = await supabase
    .from('moments')
    .select('*')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: false });
  return { moments: data ?? [], error };
}

/**
 * Add a new moment.
 */
export async function addMoment(userId, { title, body, tag, date }) {
  const { data, error } = await supabase
    .from('moments')
    .insert({
      user_id: userId,
      title,
      body,
      tag: tag ?? 'reflection',
      date: date ?? new Date().toISOString().split('T')[0],
    })
    .select()
    .single();
  return { moment: data, error };
}

/**
 * Update a moment.
 */
export async function updateMoment(momentId, updates) {
  const { data, error } = await supabase
    .from('moments')
    .update(updates)
    .eq('id', momentId)
    .select()
    .single();
  return { moment: data, error };
}

/**
 * Delete a moment.
 */
export async function deleteMoment(momentId) {
  const { error } = await supabase.from('moments').delete().eq('id', momentId);
  return { error };
}

// ─── AI RECAPS ────────────────────────────────────────────

/**
 * Fetch the most recent AI recap of a given type for a user.
 */
export async function getLatestRecap(userId, type = 'daily') {
  const { data, error } = await supabase
    .from('ai_recaps')
    .select('*')
    .eq('user_id', userId)
    .eq('type', type)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { recap: data, error };
}

/**
 * Save a new AI recap.
 */
export async function saveRecap(userId, { recap_text, type, date }) {
  const { data, error } = await supabase
    .from('ai_recaps')
    .upsert({
      user_id: userId,
      recap_text,
      type: type ?? 'daily',
      date: date ?? new Date().toISOString().split('T')[0],
    }, { onConflict: 'user_id,type,date' })
    .select()
    .single();
  return { recap: data, error };
}

/**
 * Fetch recap for a specific date and type.
 */
export async function getRecapForDate(userId, date, type = 'daily') {
  const { data, error } = await supabase
    .from('ai_recaps')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .eq('type', type)
    .maybeSingle();
  return { recap: data, error };
}

// ─── STATS ────────────────────────────────────────────────

/**
 * Calculate average daily completion % for a month.
 * Returns a number 0–100.
 */
export async function getMonthlyAverage(userId, year, month) {
  const { habits } = await getHabits(userId);
  const dailyHabits = habits.filter(h => h.type === 'daily');
  if (dailyHabits.length === 0) return 0;

  const daysInMonth = new Date(year, month, 0).getDate();
  const today = new Date();
  const daysElapsed = (year === today.getFullYear() && month === today.getMonth() + 1)
    ? today.getDate()
    : daysInMonth;

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate   = `${year}-${String(month).padStart(2, '0')}-${String(daysElapsed).padStart(2, '0')}`;

  const { logs } = await getHabitLogs(userId, startDate, endDate);
  const totalPossible = dailyHabits.length * daysElapsed;
  if (totalPossible === 0) return 0;

  return Math.round((logs.length / totalPossible) * 100);
}

/**
 * Calculate best streak across all daily habits for a user.
 */
export async function getBestStreak(userId) {
  const { habits } = await getHabits(userId);
  const dailyHabits = habits.filter(h => h.type === 'daily');
  if (dailyHabits.length === 0) return 0;

  let best = 0;
  for (const habit of dailyHabits) {
    const streak = await getHabitStreak(habit.id, userId);
    if (streak > best) best = streak;
  }
  return best;
}
