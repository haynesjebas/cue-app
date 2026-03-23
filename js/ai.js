/**
 * ai.js — ALL Claude Haiku API calls live here.
 * No screen file ever calls the Anthropic API directly.
 * To swap AI provider: change this file only.
 */

// ─── CONFIG ───────────────────────────────────────────────
// Add your key to config.js (which is ignored by git)
const ANTHROPIC_API_KEY = window.CUE_ANTHROPIC_KEY || 'YOUR_ANTHROPIC_API_KEY';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';

// ─── INTERNAL API CALL ────────────────────────────────────

async function callClaude(systemPrompt, userMessage, maxTokens = 256) {
  try {
    const response = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-client-side-allowlists': 'true',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('Claude API error:', err);
      return null;
    }

    const data = await response.json();
    return data.content?.[0]?.text ?? null;
  } catch (err) {
    console.error('Claude fetch error:', err);
    return null;
  }
}

// ─── DAILY RECAP ─────────────────────────────────────────

/**
 * Generate a daily AI recap.
 * Called after the user ticks habits and writes a moment for the day.
 *
 * @param {Object} params
 * @param {string} params.userName
 * @param {string} params.date             - ISO date string
 * @param {Array}  params.completedHabits  - Array of habit names completed today
 * @param {Array}  params.skippedHabits    - Array of habit names NOT completed
 * @param {Object} params.moment           - { title, body, tag } — today's moment (optional)
 * @returns {string|null} — 2–3 sentence personal reflection
 */
export async function generateDailyRecap({ userName, date, completedHabits, skippedHabits, moment }) {
  const system = `You are a warm, thoughtful personal coach for the Cue ritual app.
Write a 2-3 sentence personal reflection that feels human, specific, and encouraging — never generic.
Reference the actual habits and moment details provided. Speak directly to the user.
Tone: calm, wise, intimate. No emojis. No bullet points. Plain paragraph only.`;

  const habitSummary = completedHabits.length > 0
    ? `Completed today: ${completedHabits.join(', ')}.`
    : 'No habits completed today.';

  const skippedSummary = skippedHabits.length > 0
    ? `Skipped: ${skippedHabits.join(', ')}.`
    : '';

  const momentSummary = moment
    ? `Today's journal entry — "${moment.title}" (${moment.tag}): ${moment.body}`
    : 'No journal entry today.';

  const userMessage = `User: ${userName}
Date: ${date}
${habitSummary} ${skippedSummary}
${momentSummary}`;

  return callClaude(system, userMessage, 200);
}

// ─── WEEKLY NUDGE ─────────────────────────────────────────

/**
 * Generate a weekly nudge observation.
 * Called every Sunday to detect patterns across the week.
 *
 * @param {Object} params
 * @param {string} params.userName
 * @param {Array}  params.weekData - Array of { date, completedHabits: [], skippedHabits: [] }
 * @returns {string|null} — one-line observation about a detected pattern
 */
export async function generateWeeklyNudge({ userName, weekData }) {
  const system = `You are an observant personal coach for the Cue ritual app.
Write exactly ONE sentence that identifies a specific pattern from this week's data.
Be specific (mention habit names, days, patterns). Be encouraging, not judgmental.
Output ONE sentence only. No intro, no bullet points.`;

  const summary = weekData.map(day =>
    `${day.date}: completed [${day.completedHabits.join(', ') || 'none'}], skipped [${day.skippedHabits.join(', ') || 'none'}]`
  ).join('\n');

  const userMessage = `User: ${userName}\nWeek data:\n${summary}`;

  return callClaude(system, userMessage, 80);
}

// ─── MONTHLY MEMORY ──────────────────────────────────────

/**
 * Generate a monthly memory — a personal paragraph summarising the whole month.
 * Called on the last day of the month.
 *
 * @param {Object} params
 * @param {string} params.userName
 * @param {string} params.monthName        - e.g. "January 2025"
 * @param {number} params.avgCompletion    - average daily % (0–100)
 * @param {number} params.bestStreak       - best streak in days
 * @param {Array}  params.moments          - Array of { date, title, tag, body }
 * @param {Array}  params.topHabits        - Array of { name, completionPct }
 * @returns {string|null} — personal monthly reflection paragraph
 */
export async function generateMonthlyMemory({ userName, monthName, avgCompletion, bestStreak, moments, topHabits }) {
  const system = `You are a warm, reflective personal coach writing a monthly memory for a habit tracking app called Cue.
Write a 3-4 sentence personal paragraph that captures the essence of this user's month.
Reference specific moments, habits, and growth. Be poetic but grounded. No emojis. Plain paragraph only.`;

  const momentsList = moments.slice(0, 8).map(m =>
    `- "${m.title}" (${m.tag}, ${m.date}): ${m.body?.slice(0, 100)}`
  ).join('\n');

  const habitsList = topHabits.map(h => `${h.name}: ${h.completionPct}% completion`).join(', ');

  const userMessage = `User: ${userName}
Month: ${monthName}
Average daily completion: ${avgCompletion}%
Best streak: ${bestStreak} days
Top habits: ${habitsList}
Key moments this month:
${momentsList}`;

  return callClaude(system, userMessage, 300);
}

// ─── AI INSIGHT (Progress screen) ────────────────────────

/**
 * Generate an AI insight card for the Progress screen.
 * Based on habit performance data.
 *
 * @param {Object} params
 * @param {string} params.userName
 * @param {Array}  params.habits   - Array of { name, completionPct, streak }
 * @param {number} params.avgPct   - overall avg completion %
 * @returns {string|null}          - 2-sentence insight
 */
export async function generateProgressInsight({ userName, habits, avgPct }) {
  const system = `You are a data-driven personal coach for the Cue ritual app.
Write 2 sentences of actionable insight based on the user's habit performance.
Be specific: name the best habit, note a trend, and suggest one action. No emojis.`;

  const habitsList = habits.map(h =>
    `${h.name}: ${h.completionPct}%, streak ${h.streak} days`
  ).join('; ');

  const userMessage = `User: ${userName}
Overall average: ${avgPct}%
Habits: ${habitsList}`;

  return callClaude(system, userMessage, 150);
}
