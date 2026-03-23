/**
 * progress.js — Progress screen logic.
 * Only imports from db.js and ai.js.
 */

import { requireAuth } from './auth.js';
import {
  getUserProfile, getHabits, getHabitLogs, getMonthlyAverage, getBestStreak
} from './db.js';
import { generateProgressInsight } from './ai.js';

// ── Auth ───────────────────────────────────────────────────
const user = await requireAuth('./login.html');
if (!user) throw new Error('Not authenticated');

// ── State ──────────────────────────────────────────────────
const now   = new Date();
const year  = now.getFullYear();
const month = now.getMonth() + 1;
const daysInMonth = new Date(year, month, 0).getDate();
const today = now.toISOString().split('T')[0];
const startOfMonth = `${year}-${String(month).padStart(2,'0')}-01`;

let chartInstance = null;
let allLogs   = [];
let allHabits = [];

// ── DOM helper ─────────────────────────────────────────────
function $id(id) { return document.getElementById(id); }

// ── Profile ────────────────────────────────────────────────
async function loadProfile() {
  const { profile } = await getUserProfile(user.id);
  const initials = profile?.avatar_initials || user.email?.[0]?.toUpperCase() || '?';
  const name     = profile?.name || user.email;
  $id('sidebarAvatar').textContent = initials;
  $id('sidebarName').textContent   = name;
  $id('mobileAvatar').textContent  = initials;
}

// ── Month header ───────────────────────────────────────────
function updateHeader() {
  const monthName = now.toLocaleString('en-US', { month: 'long' });
  $id('progressMonth').textContent = monthName;
}

// ── Build daily completion % per day ───────────────────────
function buildDailyData(habits, logs) {
  const dailyHabits = habits.filter(h => h.type === 'daily');
  const data = [];

  for (let d = 1; d <= Math.min(daysInMonth, now.getDate()); d++) {
    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayLogs = logs.filter(l => l.completed_date === dateStr);
    const pct = dailyHabits.length > 0
      ? Math.round((dayLogs.length / dailyHabits.length) * 100)
      : 0;
    data.push({ day: d, pct });
  }

  return data;
}

// ── Chart ──────────────────────────────────────────────────
function buildChart(dailyData) {
  const ctx = document.getElementById('activityChart').getContext('2d');

  const labels = dailyData.map(d => {
    const date = new Date(year, month - 1, d.day);
    return date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase().slice(0, 3);
  });

  const values  = dailyData.map(d => d.pct);

  if (chartInstance) {
    chartInstance.destroy();
  }

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: '#22c55e',
        backgroundColor: (ctx) => {
          const gradient = ctx.chart.ctx.createLinearGradient(0, 0, 0, ctx.chart.height);
          gradient.addColorStop(0, 'rgba(34, 197, 94, 0.15)');
          gradient.addColorStop(1, 'rgba(34, 197, 94, 0)');
          return gradient;
        },
        borderWidth: 2.5,
        pointRadius: (ctx) => {
          // Show point only on last data item
          return ctx.dataIndex === values.length - 1 ? 5 : 0;
        },
        pointBackgroundColor: '#22c55e',
        pointBorderColor: '#000',
        pointBorderWidth: 2,
        tension: 0.4,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 800,
        easing: 'easeInOutQuart',
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1a1a',
          borderColor: '#2a2a2a',
          borderWidth: 1,
          titleColor: '#869585',
          bodyColor: '#e2e2e2',
          padding: 10,
          callbacks: {
            label: ctx => `${ctx.parsed.y}% completion`,
          },
        },
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255,255,255,0.03)',
          },
          ticks: {
            color: '#555',
            font: { family: 'Inter', size: 11 },
            maxTicksLimit: 7,
            maxRotation: 0,
          },
          border: { display: false },
        },
        y: {
          min: 0,
          max: 100,
          grid: {
            color: 'rgba(255,255,255,0.04)',
          },
          ticks: {
            color: '#555',
            font: { family: 'Inter', size: 11 },
            callback: v => v + '%',
            stepSize: 25,
          },
          border: { display: false },
        },
      },
    },
  });
}

// ── Week filter ────────────────────────────────────────────
function filterByWeek(dailyData, weekNum) {
  const start = (weekNum - 1) * 7 + 1;
  const end   = weekNum * 7;
  return dailyData.filter(d => d.day >= start && d.day <= end);
}

function setupWeekFilters(dailyData) {
  document.querySelectorAll('.week-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.week-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const week    = parseInt(btn.dataset.week);
      const filtered = filterByWeek(dailyData, week);
      if (filtered.length > 0) buildChart(filtered);
    });
  });

  // Default: show current week
  const currentWeek = Math.ceil(now.getDate() / 7);
  const activeBtn   = document.querySelector(`[data-week="${currentWeek}"]`)
    || document.querySelector(`[data-week="4"]`);
  if (activeBtn) {
    document.querySelectorAll('.week-filter-btn').forEach(b => b.classList.remove('active'));
    activeBtn.classList.add('active');
  }
}

// ── Ritual depth bars ──────────────────────────────────────
async function renderRitualDepth(habits, logs) {
  const depthList = $id('ritualDepthList');
  const dailyHabits = habits.filter(h => h.type === 'daily');

  if (dailyHabits.length === 0) {
    depthList.innerHTML = `<div style="color:var(--text-faint);font-size:13px;">No habits to display.</div>`;
    return;
  }

  const CATEGORIES = ['MINDFULNESS', 'PHYSICAL', 'GROWTH', 'REST'];
  const items = dailyHabits.map((h, i) => {
    const habitLogs = logs.filter(l => l.habit_id === h.id);
    const possible  = now.getDate();
    const pct       = possible > 0 ? Math.min(100, Math.round((habitLogs.length / possible) * 100)) : 0;
    const cat       = CATEGORIES[i % CATEGORIES.length];

    return { habit: h, pct, category: cat };
  });

  depthList.innerHTML = items.map(({ habit, pct, category }) => `
    <div class="ritual-depth-item">
      <div class="ritual-depth-item__header">
        <div>
          <div class="ritual-depth-item__category">${category}</div>
          <div class="ritual-depth-item__name">${habit.name}</div>
        </div>
        <div class="ritual-depth-item__pct">${pct}%</div>
      </div>
      <div class="progress-bar">
        <div class="progress-bar__fill" style="width:${pct}%;"></div>
      </div>
    </div>
  `).join('');

  // Show observation card if a habit is < 60%
  const lagging = items.filter(i => i.pct < 60);
  if (lagging.length > 0) {
    const obs = lagging[0];
    $id('observationText').textContent =
      `Your "${obs.habit.name}" ritual is at ${obs.pct}%. Consistency in this area could significantly boost your overall score.`;
    $id('observationCard').style.display = 'block';
  }

  return items;
}

// ── AI Insight ─────────────────────────────────────────────
async function loadAIInsight(habits, logs) {
  const dailyHabits = habits.filter(h => h.type === 'daily');
  if (dailyHabits.length === 0) return;

  const habitData = dailyHabits.map(h => {
    const possible  = now.getDate();
    const done      = logs.filter(l => l.habit_id === h.id).length;
    const pct       = possible > 0 ? Math.round((done / possible) * 100) : 0;

    // Streak: consecutive days from today
    let streak = 0;
    for (let i = 0; i < 30; i++) {
      const d    = new Date(now);
      d.setDate(d.getDate() - i);
      const dStr = d.toISOString().split('T')[0];
      if (logs.some(l => l.habit_id === h.id && l.completed_date === dStr)) {
        streak++;
      } else if (i > 0) break;
    }
    return { name: h.name, completionPct: pct, streak };
  });

  const avgPct = habitData.reduce((s, h) => s + h.completionPct, 0) / habitData.length;
  const name   = user.user_metadata?.name || user.email;

  $id('aiInsightCard').style.display = 'block';

  const text = await generateProgressInsight({ userName: name, habits: habitData, avgPct: Math.round(avgPct) });
  if (text) {
    $id('aiInsightText').textContent = text;
  } else {
    $id('aiInsightCard').style.display = 'none';
  }
}

// ── Main load ──────────────────────────────────────────────
async function init() {
  updateHeader();
  await loadProfile();

  const [habitData, logData, avgPct, bestStreak] = await Promise.all([
    getHabits(user.id),
    import('./db.js').then(db => db.getHabitLogs(user.id, startOfMonth, today)),
    getMonthlyAverage(user.id, year, month),
    getBestStreak(user.id),
  ]);

  allHabits = habitData.habits;
  allLogs   = logData.logs;

  // Stat cards
  $id('statAvg').textContent    = `${avgPct}%`;
  $id('statStreak').textContent = bestStreak;

  // Chart
  const dailyData  = buildDailyData(allHabits, allLogs);
  const currentWeek = Math.ceil(now.getDate() / 7);
  const weekData    = filterByWeek(dailyData, currentWeek).length > 0
    ? filterByWeek(dailyData, currentWeek)
    : dailyData;
  buildChart(weekData);
  setupWeekFilters(dailyData);

  // Live sync badge (show on mobile)
  $id('liveBadge').style.display = window.innerWidth < 768 ? 'inline' : 'none';

  // Ritual depth
  await renderRitualDepth(allHabits, allLogs);

  // AI (non-blocking)
  loadAIInsight(allHabits, allLogs).catch(console.error);
}

init();
