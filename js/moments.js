/**
 * moments.js — Moments screen logic.
 * Only imports from db.js and ai.js.
 */

import { requireAuth } from './auth.js';
import {
  getUserProfile, getMomentsByMonth, addMoment, updateMoment, deleteMoment,
  getLatestRecap, saveRecap, getHabits, getHabitLogs
} from './db.js';
import { generateDailyRecap, generateWeeklyNudge } from './ai.js';

// ── Auth ───────────────────────────────────────────────────
const user = await requireAuth('/login.html');
if (!user) throw new Error('Not authenticated');

// ── State ──────────────────────────────────────────────────
const now   = new Date();
const year  = now.getFullYear();
const month = now.getMonth() + 1; // 1-indexed
const daysInMonth = new Date(year, month, 0).getDate();

let moments       = [];
let editingMoment = null;
let selectedTag   = 'milestone';

// ── DOM helpers ────────────────────────────────────────────
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
  const initials = profile?.avatar_initials
    || user.user_metadata?.avatar_initials
    || user.email?.[0]?.toUpperCase()
    || '?';
  const name = profile?.name || user.user_metadata?.name || user.email;

  $id('sidebarAvatar').textContent = initials;
  $id('sidebarName').textContent   = name;
  $id('mobileAvatar').textContent  = initials;
}

// ── Month header ───────────────────────────────────────────
function updateHeader() {
  const monthName = now.toLocaleString('en-US', { month: 'long' });
  $id('monthTitle').textContent  = monthName;
  $id('monthSub').textContent    = `${moments.length} of ${daysInMonth} captured`;
}

// ── Tag rendering ──────────────────────────────────────────
function tagClass(tag) {
  return {
    milestone:  'tag--milestone',
    adventure:  'tag--adventure',
    reflection: 'tag--reflection',
  }[tag] || 'tag--reflection';
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
}

// ── Render moment cards ────────────────────────────────────
function renderMoments() {
  const list = $id('momentsList');

  if (moments.length === 0) {
    list.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <div class="empty-state__icon">✨</div>
        <div class="empty-state__title">No moments yet</div>
        <div class="empty-state__sub">Start capturing your journey — one moment at a time.</div>
      </div>`;
    return;
  }

  list.innerHTML = moments.map((m, i) => `
    <div class="moment-card fade-in" style="animation-delay:${i * 0.04}s"
         data-id="${m.id}">
      <div class="moment-card__meta">
        <span class="moment-card__date">${formatDate(m.date)}</span>
        <span class="tag ${tagClass(m.tag)}">${m.tag.toUpperCase()}</span>
      </div>
      <div class="moment-card__title">${escapeHtml(m.title)}</div>
      <div class="moment-card__body">${escapeHtml(m.body || '')}</div>
    </div>
  `).join('');

  // Click to edit
  list.querySelectorAll('.moment-card').forEach(card => {
    card.addEventListener('click', () => {
      const id  = card.dataset.id;
      const m   = moments.find(x => x.id === id);
      if (m) openEditMoment(m);
    });
  });
}

function escapeHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── AI Recap ───────────────────────────────────────────────
async function loadAIRecap() {
  // Check for stored recap from today
  const today = now.toISOString().split('T')[0];
  const { recap } = await getLatestRecap(user.id, 'daily');

  const aiCard = $id('aiRecapCard');
  const aiText = $id('aiRecapText');

  if (recap && recap.date === today) {
    aiText.textContent = recap.recap_text;
    aiCard.style.display = 'block';
    return;
  }

  // Generate a new recap if there's data for today
  const todayMoment = moments.find(m => m.date === today);
  const { habits }  = await getHabits(user.id);
  const startDate   = `${year}-${String(month).padStart(2,'0')}-01`;
  const { logs }    = await getHabitLogs(user.id, startDate, today);

  const todayLogs = logs.filter(l => l.completed_date === today);
  const todayIds  = todayLogs.map(l => l.habit_id);

  const completed = habits.filter(h => todayIds.includes(h.id)).map(h => h.name);
  const skipped   = habits.filter(h => !todayIds.includes(h.id)).map(h => h.name);

  if (completed.length === 0 && !todayMoment) {
    aiCard.style.display = 'none';
    return;
  }

  aiCard.style.display = 'block';
  aiText.textContent   = 'Reflecting on your day…';

  const name = user.user_metadata?.name || user.email;
  const text = await generateDailyRecap({
    userName:        name,
    date:            today,
    completedHabits: completed,
    skippedHabits:   skipped,
    moment:          todayMoment ?? null,
  });

  if (text) {
    aiText.textContent = `"${text}"`;
    await saveRecap(user.id, { recap_text: text, type: 'daily', date: today });
  } else {
    aiCard.style.display = 'none';
  }
}

// ── Weekly nudge (Sundays only) ────────────────────────────
async function loadNudge() {
  // Only show on Sundays or if cached
  const cachedNudge = sessionStorage.getItem('cue_nudge');
  if (cachedNudge) {
    $id('nudgeText').innerHTML = cachedNudge;
    $id('nudgeCard').style.display = 'flex';
    return;
  }

  const dayOfWeek = now.getDay(); // 0 = Sunday
  if (dayOfWeek !== 0) return;

  // Gather last 7 days
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr   = d.toISOString().split('T')[0];
    const { habits } = await getHabits(user.id);
    const { logs }   = await getHabitLogs(user.id, dateStr, dateStr);
    const doneIds    = logs.map(l => l.habit_id);
    days.push({
      date:            dateStr,
      completedHabits: habits.filter(h => doneIds.includes(h.id)).map(h => h.name),
      skippedHabits:   habits.filter(h => !doneIds.includes(h.id)).map(h => h.name),
    });
  }

  const name = user.user_metadata?.name || user.email;
  const nudge = await generateWeeklyNudge({ userName: name, weekData: days });

  if (nudge) {
    $id('nudgeText').textContent = nudge;
    $id('nudgeCard').style.display = 'flex';
    sessionStorage.setItem('cue_nudge', nudge);
  }
}

// ── Modal ──────────────────────────────────────────────────
function openModal()  { $id('momentModal').classList.add('open'); }
function closeModal() {
  $id('momentModal').classList.remove('open');
  editingMoment = null;
  resetForm();
}

function resetForm() {
  $id('momentTitle').value = '';
  $id('momentBody').value  = '';
  $id('momentFormMsg').style.display = 'none';
  $id('modalTitle').textContent      = 'Log a Moment';
  $id('btnMomentSave').textContent   = 'Save Moment';
  selectedTag = 'milestone';
  updateTagButtons();
}

function openEditMoment(m) {
  editingMoment              = m;
  $id('modalTitle').textContent    = 'Edit Moment';
  $id('btnMomentSave').textContent = 'Update Moment';
  $id('momentTitle').value         = m.title;
  $id('momentBody').value          = m.body || '';
  selectedTag = m.tag;
  updateTagButtons();
  openModal();
}

function updateTagButtons() {
  $id('momentTag').value = selectedTag;
  document.querySelectorAll('.tag-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.tag === selectedTag);
  });
}

// ── Tag button clicks ──────────────────────────────────────
document.querySelectorAll('.tag-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedTag = btn.dataset.tag;
    updateTagButtons();
  });
});

// ── Add/Edit buttons ───────────────────────────────────────
[$id('mobileAddBtn'), $id('desktopAddBtn'), $id('dashedAddBtn')].forEach(btn => {
  btn?.addEventListener('click', () => { editingMoment = null; resetForm(); openModal(); });
});

$id('btnMomentCancel').addEventListener('click', closeModal);

$id('momentModal').addEventListener('click', e => {
  if (e.target === $id('momentModal')) closeModal();
});

// ── Save moment ────────────────────────────────────────────
$id('momentForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $id('momentTitle').value.trim();
  const body  = $id('momentBody').value.trim();
  const tag   = $id('momentTag').value;
  const msgEl = $id('momentFormMsg');

  if (!title) {
    msgEl.style.color   = 'var(--red)';
    msgEl.textContent   = 'Please add a title.';
    msgEl.style.display = 'block';
    return;
  }

  const btn = $id('btnMomentSave');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const today = now.toISOString().split('T')[0];

  if (editingMoment) {
    const { error } = await updateMoment(editingMoment.id, { title, body, tag });
    if (error) {
      msgEl.style.color   = 'var(--red)';
      msgEl.textContent   = 'Failed to update. Try again.';
      msgEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Update Moment';
      return;
    }
    showToast('Moment updated', 'success');
  } else {
    const { error } = await addMoment(user.id, { title, body, tag, date: today });
    if (error) {
      msgEl.style.color   = 'var(--red)';
      msgEl.textContent   = 'Failed to save. Try again.';
      msgEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Save Moment';
      return;
    }
    showToast('Moment captured ✨', 'success');
  }

  closeModal();
  await loadMoments();
});

// ── Load moments ───────────────────────────────────────────
async function loadMoments() {
  const { moments: data } = await getMomentsByMonth(user.id, year, month);
  moments = data;
  updateHeader();
  renderMoments();
}

// ── Init ───────────────────────────────────────────────────
async function init() {
  await loadProfile();
  await loadMoments();
  // Load AI features without blocking UI
  loadAIRecap().catch(console.error);
  loadNudge().catch(console.error);
}

init();
