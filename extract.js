// ─── Azelux Config Extractor — Vercel Serverless Function ────────────────────
// Groq API w/ automatic model fallback
// Set GROQ_API_KEY in Vercel → Settings → Environment Variables

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

// Model chain: fastest first, fallback if slow/overloaded
const MODELS = [
  {
    id:      'meta-llama/llama-4-scout-17b-16e-instruct',
    name:    'Llama 4 Scout',
    timeout: 5500,   // abort if no response within this ms
  },
  {
    id:      'llama-3.2-11b-vision-preview',
    name:    'Llama 3.2 11B',
    timeout: 7000,
  },
];

// 9 s total budget — keeps us safely under Vercel Hobby's 10 s limit
const TOTAL_BUDGET_MS = 9000;

const PROMPT = `This is a screenshot from the Azelux Minecraft Bedrock client.
Find and extract these three config code lines exactly as they appear:
  acx1@[long digit string]
  acx2@[long digit string]
  acx3@[digit string]@[QR code image]

Return ONLY a JSON object — no markdown, no explanation, no extra text:
{"acx1":"[every digit after acx1@]","acx2":"[every digit after acx2@]","acx3":"[digits between acx3@ and the second @]"}

Rules:
- Copy digits exactly — do not add, remove, or guess any digit
- The image may be dark, blurry, or use the Minecraft bitmap font — read carefully
- acx3 value is only the digits BEFORE the QR code (before the second @)`;

module.exports = async (req, res) => {
  // CORS — same-origin on Vercel but safe to allow all for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'GROQ_API_KEY is not set. Add it in Vercel → Settings → Environment Variables.',
    });
  }

  const { imageBase64, imageType } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: 'No image data received.' });

  const started   = Date.now();
  let lastError   = 'Unknown error';

  for (let i = 0; i < MODELS.length; i++) {
    const { id, name, timeout } = MODELS[i];

    const elapsed   = Date.now() - started;
    const remaining = TOTAL_BUDGET_MS - elapsed;
    if (remaining < 800) break; // not enough time left for another attempt

    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), Math.min(timeout, remaining));

    try {
      const groqRes = await fetch(GROQ_ENDPOINT, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model:       id,
          max_tokens:  300,
          temperature: 0,
          messages: [{
            role: 'user',
            content: [
              {
                type:      'image_url',
                image_url: { url: `data:${imageType || 'image/jpeg'};base64,${imageBase64}` },
              },
              { type: 'text', text: PROMPT },
            ],
          }],
        }),
        signal: controller.signal,
      });

      clearTimeout(abortTimer);

      if (!groqRes.ok) {
        const errBody = await groqRes.json().catch(() => ({}));
        throw new Error(errBody.error?.message || `${name} returned HTTP ${groqRes.status}`);
      }

      const data  = await groqRes.json();
      const raw   = data.choices?.[0]?.message?.content || '';
      const clean = raw.replace(/```json|```/g, '').trim();
      const codes = JSON.parse(clean);

      if (!codes.acx1 || !codes.acx2 || !codes.acx3) {
        throw new Error(`${name} returned incomplete data`);
      }

      // ✅ Success
      return res.status(200).json({
        codes,
        model:       name,
        modelId:     id,
        attempt:     i + 1,
        wasFallback: i > 0,
        ms:          Date.now() - started,
      });

    } catch (err) {
      clearTimeout(abortTimer);

      if (err.name === 'AbortError') {
        lastError = `${name} timed out after ${timeout}ms`;
      } else {
        lastError = err.message || `${name} failed`;
      }

      // Try next model in chain
      console.error(`[azelux] Model ${i + 1} (${name}) failed: ${lastError}`);
    }
  }

  return res.status(500).json({
    error:    lastError,
    attempts: MODELS.length,
    hint:     'Try a clearer screenshot — make sure all three lines are fully visible.',
  });
};
