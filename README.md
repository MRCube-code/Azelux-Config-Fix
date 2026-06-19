# Azelux Config Tool

Clean config screenshot generator for the Azelux Minecraft Bedrock client.  
Uses **Groq AI** (free, extremely fast) with automatic model fallback.

---

## Setup — 2 steps

### 1. Get a free Groq API key
1. Go to [console.groq.com](https://console.groq.com)
2. Sign up (free) → **API Keys** → **Create API Key**
3. Copy the key (starts with `gsk_...`)

### 2. Add it to Vercel
1. Open your Vercel project dashboard
2. Go to **Settings → Environment Variables**
3. Add:
   - **Name:** `GROQ_API_KEY`
   - **Value:** `gsk_your_key_here`
   - **Environments:** ✅ Production ✅ Preview ✅ Development
4. Click **Save** then **Redeploy**

That's it. The key stays server-side — it's never sent to the browser.

---

## Deploy to Vercel

### Option A — Drag & Drop (fastest)
1. Go to [vercel.com/new](https://vercel.com/new)
2. Drag the project folder onto the page
3. Set the `GROQ_API_KEY` env var before deploying
4. Click **Deploy**

### Option B — Vercel CLI
```bash
npm i -g vercel
cd your-project-folder
vercel
# Then add the env var in the Vercel dashboard and redeploy
```

### Option C — GitHub
1. Push to a GitHub repo
2. [vercel.com/new](https://vercel.com/new) → Import Git Repository
3. Add `GROQ_API_KEY` in the Environment Variables section during setup

---

## Project structure

```
/
├── index.html        ← entire frontend (static, no build step)
├── api/
│   └── extract.js    ← serverless function (Groq API + fallback logic)
├── vercel.json       ← deployment config
└── README.md
```

---

## AI Model chain

| Priority | Model | Speed | Notes |
|----------|-------|-------|-------|
| 1st | Llama 4 Scout 17B | ~1–2s | Multimodal, fastest on Groq |
| 2nd (fallback) | Llama 3.2 11B Vision | ~2–4s | Kicks in if Scout is slow/overloaded |

The fallback is automatic — if the primary model doesn't respond within ~5.5 seconds, the server switches to the backup. The UI shows a live status message so you know what's happening.

---

## Local development

```bash
npm i -g vercel
vercel dev   # runs both the static site and the /api/extract function locally
```

Set the env var for local dev:
```bash
vercel env pull .env.local   # pulls env vars from Vercel to local
# or just create .env.local manually:
# GROQ_API_KEY=gsk_your_key_here
```
