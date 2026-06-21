// ─── Azelux Config Extractor — Parallel model race ────────────────────────────
// Fires all vision models simultaneously, returns whichever responds first.
// If one model is queued/slow, another wins. No sequential waiting.

const https = require('https');

const GROQ_HOST = 'api.groq.com';
const GROQ_PATH = '/openai/v1/chat/completions';

// All vision-capable models on Groq free tier
// They race in parallel — fastest/least-queued wins
const MODELS = [
  { id: 'meta-llama/llama-4-scout-17b-16e-instruct',    name: 'Llama 4 Scout'    },
  { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick' },
  { id: 'llama-3.2-11b-vision-preview',                  name: 'Llama 3.2 11B'   },
  { id: 'llama-3.2-90b-vision-preview',                  name: 'Llama 3.2 90B'   },
];

const TIMEOUT_MS = 12000; // per model — well under Vercel's 15s function limit

const PROMPT =
`This is a screenshot from the Azelux Minecraft Bedrock client.
Find the three config code lines and extract them:
  acx1@[long digit string]
  acx2@[long digit string]
  acx3@[digit string]@[QR code]

Return ONLY a JSON object — no markdown, no explanation:
{"acx1":"[digits after acx1@]","acx2":"[digits after acx2@]","acx3":"[digits between acx3@ and the second @]"}

Copy every digit exactly. The image may be dark or use the Minecraft bitmap font.`;

// ── Read request body ──────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let raw = '';
    req.on('data', c => { raw += c.toString(); });
    req.on('end',  ()  => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

// ── Try one model — resolves on success, rejects on any failure ───────────────
function tryModel(apiKey, modelId, modelName, imageBase64, imageType) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model:       modelId,
      max_tokens:  300,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${imageType};base64,${imageBase64}` } },
          { type: 'text', text: PROMPT },
        ],
      }],
    });

    const req = https.request({
      hostname: GROQ_HOST,
      path:     GROQ_PATH,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization':  `Bearer ${apiKey}`,
      },
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);

          // Groq returned an API-level error (queued, rate limit, etc.)
          if (json.error) {
            reject(new Error(`${modelName}: ${json.error.message}`));
            return;
          }

          const raw   = json.choices?.[0]?.message?.content || '';
          const clean = raw.replace(/```json|```/g, '').trim();
          const codes = JSON.parse(clean);

          if (!codes.acx1 || !codes.acx2 || !codes.acx3) {
            reject(new Error(`${modelName}: incomplete codes returned`));
            return;
          }

          resolve({ codes, model: modelName, modelId });

        } catch (e) {
          reject(new Error(`${modelName}: ${e.message}`));
        }
      });
    });

    req.on('error', e => reject(new Error(`${modelName}: ${e.message}`)));

    // Kill this model attempt if it takes too long
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error(`${modelName}: timed out after ${TIMEOUT_MS}ms`));
    });

    req.write(payload);
    req.end();
  });
}

// ── Handler ────────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Content-Type',                 'application/json');
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end('{}'); return; }
  if (req.method !== 'POST')   { res.status(405).json({ error: 'Method not allowed' }); return; }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GROQ_API_KEY not set in Vercel environment variables.' });
    return;
  }

  let body;
  try { body = await readBody(req); }
  catch { res.status(400).json({ error: 'Could not read request body.' }); return; }

  const { imageBase64, imageType = 'image/jpeg' } = body;
  if (!imageBase64) { res.status(400).json({ error: 'No image data in request.' }); return; }

  const started = Date.now();

  // Fire all models at the same time — Promise.any resolves with first success
  const race = MODELS.map(({ id, name }) =>
    tryModel(apiKey, id, name, imageBase64, imageType)
  );

  try {
    const result = await Promise.any(race);
    res.status(200).json({
      codes:  result.codes,
      model:  result.model,
      ms:     Date.now() - started,
    });
  } catch (aggregateErr) {
    // All models failed — collect their error messages
    const reasons = aggregateErr.errors
      ? aggregateErr.errors.map(e => e.message).join(' | ')
      : 'All models failed or timed out.';

    console.error('[azelux] all models failed:', reasons);
    res.status(500).json({
      error: 'All models are busy or timed out. Wait a few seconds and try again.',
      detail: reasons,
    });
  }
};

