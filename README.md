# Cue PWA

Your personal daily ritual and habit tracker.

## Setup Instructions

This app uses Supabase for the database and authentication, and Anthropic's Claude Haiku for AI summaries.

**IMPORTANT:** Before running the app, you must set up your API keys.

1. Rename `config.example.js` to `config.js`
2. Open `config.js` and paste your actual Anthropic API key:
   `window.CUE_ANTHROPIC_KEY = 'YOUR_ACTUAL_KEY';`
3. Since `config.js` is inside `.gitignore`, it will not be pushed to GitHub, keeping your key safe.
4. Add your Supabase credentials to `js/auth.js`.

To run locally:
```bash
python3 -m http.server 3000
```
Then visit `http://localhost:3000`.
