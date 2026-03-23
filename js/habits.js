/**
 * habits.js — Habits screen logic.
 * Only imports from db.js.
 */

import { requireAuth } from './auth.js';
import {
  getUserProfile, getHabits, getHabitLogs, logHabitCompletion, removeHabitLog,
  getHabitStreak, createHabit, getMonthlyCompletionData
} from './db.js';

// ── Auth ───────────────────────────────────────────────────
const user = await requireAuth('/login.html');
if (!user) throw new Error('Not authenticated');

// ── State ──────────────────────────────────────────────────
const now       = new Date();
const today     = now.toISOString().split('T')[0];
const todayDate = now.getDate();
const todayDay  = now.getDay(); // 0=Sun
const year      = now.getFullYear();
const month     = now.getMonth() + 1;
const daysInMonth = new Date(year, month, 0).getDate();

let habits  = [];
let todayLogs = [];
let HABIT_ICONS = {};

// Default icons per category
const DEFAULT_ICONS = {
  daily:   ['💧', '📚', '🏃', '🧘', '🎯', '🌅', '💪', '✍️'],
  weekly:  ['⭐', '🍽️', '📖', '🌊', '🔥'],
  monthly: ['🎯', '🏆', '📊', '🌙'],
};

// ── DOM helper ─────────────────────────────────────────────
function $id(id) { return document.getElementById(id); }

function showToast(msg, type = '') {
  const container = $id('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast${type ? ' toast--' + type : ''}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ── Profile ────────────────────────────────────────────────
async function loadProfile() {
  const { profile } = await getUserProfile(user.id);
  const initials = profile?.avatar_initials || user.email?.[0]?.toUpperCase() || '?';
  const name     = profile?.name || user.email;
  $id('sidebarAvatar').textContent = initials;
  $id('sidebarName').textContent   = name;
  $id('mobileAvatar').textContent  = initials;
}

// ── Hero header ────────────────────────────────────────────
function updateHero() {
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  $id('heroDate').textContent = `Today · ${dateStr}`;

  const totalHabits = habits.length;
  const todayDoneCount = todayLogs.length;
  $id('heroSub').textContent = `${todayDoneCount} of ${totalHabits} done`;

  // Dash progress
  const dashEl = $id('dashProgress');
  const maxDashes = Math.min(totalHabits, 10);
  dashEl.innerHTML = '';
  for (let i = 0; i < maxDashes; i++) {
    const seg = document.createElement('div');
    seg.className = 'dash-seg' + (i < todayDoneCount ? ' done' : '');
    dashEl.appendChild(seg);
  }

  // Weekly score
  const weeklyPct = totalHabits > 0
    ? Math.round((todayDoneCount / totalHabits) * 100)
    : 0;
  $id('weeklyScore').textContent = totalHabits > 0 ? `${weeklyPct}% Weekly Score` : '';
}

// ── Streak dots ────────────────────────────────────────────
function buildStreakDots(habitId, logs, streakCount, total = 5) {
  // Show last `total` interactions as dots
  const recentLogs = logs.filter(l => l.habit_id === habitId)
    .slice(0, total)
    .map(l => l.completed_date);

  const dots = [];
  for (let i = total - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dStr = d.toISOString().split('T')[0];
    dots.push(recentLogs.includes(dStr));
  }

  return dots.map(filled =>
    `<div class="streak-dot${filled ? ' filled' : ''}"></div>`
  ).join('');
}

// ── Monthly completion % ────────────────────────────────────
function getMonthlyPct(habitId, logs) {
  const monthLogs = logs.filter(l =>
    l.habit_id === habitId &&
    l.completed_date >= `${year}-${String(month).padStart(2,'0')}-01`
  );
  const possible = todayDate; // days elapsed this month
  return possible > 0 ? Math.round((monthLogs.length / possible) * 100) : 0;
}

// ── Render DAILY habits ────────────────────────────────────
function renderDaily(logs) {
  const dailyList = $id('dailyList');
  const dailyHabits = habits.filter(h => h.type === 'daily');

  if (dailyHabits.length === 0) {
    dailyList.innerHTML = `<div style="color:var(--text-faint);font-size:13px;padding:8px 0;">No daily rituals yet. Add one below.</div>`;
    return;
  }

  dailyList.innerHTML = dailyHabits.map((h, i) => {
    const icon    = h.icon || DEFAULT_ICONS.daily[i % DEFAULT_ICONS.daily.length];
    const isDone  = todayLogs.some(l => l.habit_id === h.id);
    const pct     = getMonthlyPct(h.id, logs);
    const dots    = buildStreakDots(h.id, logs, 0, 5);

    return `
      <div class="habit-row" data-id="${h.id}" data-done="${isDone}" style="${isDone ? 'border-color:#1a2e1a;' : ''}">
        <div class="habit-icon" style="${isDone ? 'background:rgba(34,197,94,0.1);' : ''}">${icon}</div>
        <div class="habit-row__info">
          <div class="habit-row__name" style="${isDone ? 'color:var(--green);' : ''}">${h.name}</div>
          <div class="habit-row__target">${h.target_count > 1 ? h.target_count + 'x ' : ''}${h.target_label || formatTarget(h)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="streak-dots">${dots}</div>
        </div>
      </div>`;
  }).join('');

  // Toggle on click
  dailyList.querySelectorAll('.habit-row').forEach(row => {
    row.addEventListener('click', () => toggleHabit(row, logs));
  });
}

function formatTarget(h) {
  if (h.target_label) return h.target_label;
  return `${h.target_count || 1} per day`;
}

// ── Render WEEKLY habits ────────────────────────────────────
function renderWeekly(logs) {
  const weeklyList  = $id('weeklyList');
  const weeklyHabits = habits.filter(h => h.type === 'weekly');
  const weekLabel   = $id('weeklyDoneLabel');

  if (weeklyHabits.length === 0) {
    weeklyList.innerHTML = `<div style="color:var(--text-faint);font-size:13px;grid-column:1/-1;">No weekly rituals yet.</div>`;
    return;
  }

  // Count how many done this week
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - todayDay);
  const weekStartStr = weekStart.toISOString().split('T')[0];

  const weekDone = weeklyHabits.filter(h =>
    logs.some(l => l.habit_id === h.id && l.completed_date >= weekStartStr)
  ).length;
  weekLabel.textContent = `${weekDone} / ${weeklyHabits.length} Done`;

  weeklyList.innerHTML = weeklyHabits.map((h, i) => {
    const icon    = h.icon || DEFAULT_ICONS.weekly[i % DEFAULT_ICONS.weekly.length];
    const isDone  = logs.some(l => l.habit_id === h.id && l.completed_date >= weekStartStr);
    const pct     = isDone ? 100 : Math.round((weekDone / weeklyHabits.length) * 100);

    return `
      <div class="weekly-card" data-id="${h.id}" data-type="weekly"
           style="${isDone ? 'border-color:rgba(34,197,94,0.3);background:rgba(34,197,94,0.04);' : ''}">
        <div class="weekly-card__icon">${icon}</div>
        <div class="weekly-card__name" style="${isDone ? 'color:var(--green);' : ''}">${h.name}</div>
        <div class="weekly-card__sub">${isDone ? '✓ Completed' : 'Pending'}</div>
      </div>`;
  }).join('');

  weeklyList.querySelectorAll('[data-type="weekly"]').forEach(card => {
    card.addEventListener('click', () => toggleHabitCard(card, logs));
  });
}

// ── Render MONTHLY habits ─────────────────────────────────
function renderMonthly(logs) {
  const monthlyList   = $id('monthlyList');
  const monthlyHabits = habits.filter(h => h.type === 'monthly');
  const goalCard      = $id('monthlyGoalCard');

  if (monthlyHabits.length === 0) {
    monthlyList.innerHTML = '';
    goalCard.style.display = 'none';
    return;
  }

  // Desktop: show first monthly as feature card
  const featured = monthlyHabits[0];
  const monthStr = `${year}-${String(month).padStart(2,'0')}`;
  const monthLogs = logs.filter(l => l.habit_id === featured.id && l.completed_date.startsWith(monthStr));
  const target = featured.target_count || 30;
  const pct    = Math.min(100, Math.round((monthLogs.length / target) * 100));
  const circ   = 2 * Math.PI * 32; // r=32

  goalCard.style.display = 'block';
  $id('monthlyGoalTitle').textContent  = featured.name;
  $id('monthlyGoalSub').textContent    = featured.target_label || '';
  $id('monthlyGoalValue').textContent  = monthLogs.length;
  $id('monthlyGoalTarget').textContent = `/ ${target}`;
  $id('donutLabel').textContent        = `${pct}%`;
  $id('donutCircle').style.strokeDashoffset = circ - (circ * pct / 100);

  // Mobile: show all as progress bar cards
  monthlyList.innerHTML = monthlyHabits.map(h => {
    const mLogs  = logs.filter(l => l.habit_id === h.id && l.completed_date.startsWith(monthStr));
    const tgt    = h.target_count || 30;
    const p      = Math.min(100, Math.round((mLogs.length / tgt) * 100));

    return `
      <div class="card" style="padding:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div style="font-size:14px;font-weight:600;color:var(--text-primary);">${h.name}</div>
          <div style="font-size:13px;font-weight:700;color:var(--green);">${mLogs.length}/${tgt}</div>
        </div>
        <div class="progress-bar progress-bar--thick">
          <div class="progress-bar__fill" style="width:${p}%;"></div>
        </div>
      </div>`;
  }).join('');
}

// ── Toggle daily habit ─────────────────────────────────────
async function toggleHabit(row, logs) {
  const habitId = row.dataset.id;
  const isDone  = row.dataset.done === 'true';

  // Optimistic UI
  row.dataset.done = (!isDone).toString();
  row.style.borderColor = !isDone ? '#1a2e1a' : '';

  if (isDone) {
    await removeHabitLog(habitId, user.id, today);
    todayLogs = todayLogs.filter(l => l.habit_id !== habitId);
  } else {
    const { log } = await logHabitCompletion(habitId, user.id, today);
    if (log) todayLogs.push(log);
  }

  updateHero();
  updateStats(logs);
}

// ── Toggle weekly habit card ───────────────────────────────
async function toggleHabitCard(card, logs) {
  const habitId = card.dataset.id;
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - todayDay);
  const weekStartStr = weekStart.toISOString().split('T')[0];

  const already = logs.some(l => l.habit_id === habitId && l.completed_date >= weekStartStr);

  if (already) {
    await removeHabitLog(habitId, user.id, today);
  } else {
    await logHabitCompletion(habitId, user.id, today);
  }

  // Reload
  await loadHabits();
}

// ── Stats ──────────────────────────────────────────────────
async function updateStats(logs) {
  const totalHabits  = habits.filter(h => h.type === 'daily').length;
  const score        = totalHabits > 0 ? Math.round((todayLogs.length / totalHabits) * 100) : 0;
  $id('ritualScore').textContent = score;
  $id('ritualScoreChange').textContent = score >= 80 ? '+4% vs last week' : '';

  // Active days: days with at least 1 log this month
  const monthStr   = `${year}-${String(month).padStart(2,'0')}`;
  const monthLogs  = logs.filter(l => l.completed_date.startsWith(monthStr));
  const activeDays = new Set(monthLogs.map(l => l.completed_date)).size;
  $id('activeDays').textContent  = activeDays;
  $id('activeDaysSub').textContent = `out of ${todayDate} days`;
}

// ── Main load ──────────────────────────────────────────────
async function loadHabits() {
  const startOfMonth = `${year}-${String(month).padStart(2,'0')}-01`;
  const [habitData, logData] = await Promise.all([
    getHabits(user.id),
    import('./db.js').then(db => db.getHabitLogs(user.id, startOfMonth, today)),
  ]);

  habits    = habitData.habits;
  const logs = logData.logs;

  todayLogs = logs.filter(l => l.completed_date === today);

  updateHero();
  renderDaily(logs);
  renderWeekly(logs);
  renderMonthly(logs);
  updateStats(logs);

  // Alert banner (mobile only)
  checkAlertBanner();
}

function checkAlertBanner() {
  // Show alert if today has < 50% completion
  const pct = habits.length > 0
    ? Math.round((todayLogs.length / habits.length) * 100)
    : 0;

  if (pct < 50 && habits.length > 0) {
    const remaining = habits.length - todayLogs.length;
    $id('alertText').textContent = `${remaining} ritual${remaining !== 1 ? 's' : ''} remaining. Keep the momentum going.`;
    $id('alertBanner').style.display = 'flex';
  } else {
    $id('alertBanner').style.display = 'none';
  }
}

// ── New Ritual modal ───────────────────────────────────────
let selectedType = 'daily';

function openRitualModal() {
  $id('newRitualModal').classList.add('open');
}

function closeRitualModal() {
  $id('newRitualModal').classList.remove('open');
  $id('ritualName').value   = '';
  $id('ritualTarget').value = '1';
  $id('ritualIcon').value   = '';
  $id('ritualFormMsg').style.display = 'none';
  selectedType = 'daily';
  updateTypeButtons();
}

function updateTypeButtons() {
  $id('ritualType').value = selectedType;
  ['daily','weekly','monthly'].forEach(t => {
    const btn = document.querySelector(`.modal [data-type="${t}"]`);
    if (btn) btn.classList.toggle('selected', t === selectedType);
  });
}

document.querySelectorAll('.modal [data-type]').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedType = btn.dataset.type;
    updateTypeButtons();
  });
});

$id('newRitualBtn').addEventListener('click', openRitualModal);
$id('btnRitualCancel').addEventListener('click', closeRitualModal);
$id('viewTrendsBtn')?.addEventListener('click', () => {
  window.location.href = '/progress.html';
});

$id('newRitualModal').addEventListener('click', e => {
  if (e.target === $id('newRitualModal')) closeRitualModal();
});

$id('newRitualForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name   = $id('ritualName').value.trim();
  const target = parseInt($id('ritualTarget').value) || 1;
  const icon   = $id('ritualIcon').value.trim();
  const msgEl  = $id('ritualFormMsg');

  if (!name) {
    msgEl.style.color   = 'var(--red)';
    msgEl.textContent   = 'Please enter a name.';
    msgEl.style.display = 'block';
    return;
  }

  const btn = e.submitter;
  btn.disabled    = true;
  btn.textContent = 'Creating…';

  const { error } = await createHabit(user.id, {
    name,
    type: selectedType,
    target_count: target,
    days_of_week: [],
  });

  btn.disabled    = false;
  btn.textContent = 'Create Ritual';

  if (error) {
    msgEl.style.color   = 'var(--red)';
    msgEl.textContent   = error.message;
    msgEl.style.display = 'block';
    return;
  }

  closeRitualModal();
  showToast('Ritual created ✓', 'success');
  await loadHabits();
});

// ── Init ───────────────────────────────────────────────────
async function init() {
  await loadProfile();
  await loadHabits();
}

init();
