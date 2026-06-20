// ─── Azelux Config Extractor — Vercel Serverless Function ─────────────────────
// Uses Node's built-in https module (no dependencies, works on all Node versions)

const https = require('https');

const GROQ_HOST = 'api.groq.com';
const GROQ_PATH = '/openai/v1/chat/completions';

const MODELS = [
  { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout',  timeoutMs: 5500 },
  { id: 'llama-3.2-11b-vision-preview',               name: 'Llama 3.2 11B', timeoutMs: 7000 },
];

const PROMPT =
`This is a screenshot from the Azelux Minecraft Bedrock client.
Find the three config code lines and extract them exactly:
  acx1@[long digit string]
  acx2@[long digit string]
  acx3@[digit string]@[QR code]

Return ONLY a JSON object — no markdown, no explanation:
{"acx1":"[digits after acx1@]","acx2":"[digits after acx2@]","acx3":"[digits between acx3@ and the second @]"}

Copy every digit exactly. The screenshot may be dark or use the Minecraft font.`;

// ── Read raw body (handles both pre-parsed and unparsed Vercel requests) ───────
function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let raw = '';
    req.on('data', chunk => { raw += chunk.toString(); });
    req.on('end',  ()    => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

// ── HTTPS POST to Groq with timeout ───────────────────────────────────────────
function groqPost(apiKey, modelId, imageBase64, imageType, timeoutMs) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model:       modelId,
      max_tokens:  300,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${imageType};base64,${imageBase64}` } },
          { type: 'text',      text: PROMPT },
        ],
      }],
    });

    const options = {
      hostname: GROQ_HOST,
      path:     GROQ_PATH,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization':  `Bearer ${apiKey}`,
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          reject(new Error(`Non-JSON response from Groq (HTTP ${res.statusCode})`));
        }
      });
    });

    req.on('error', reject);

    // Hard timeout — destroy socket if model is too slow
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`${modelId} timed out after ${timeoutMs}ms`));
    });

    req.write(payload);
    req.end();
  });
}

// ── Handler ────────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  // Always return JSON — never HTML
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end('{}'); return; }
  if (req.method !== 'POST')   { res.status(405).json({ error: 'Method not allowed' }); return; }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GROQ_API_KEY is not set. Add it in Vercel → Settings → Environment Variables, then redeploy.' });
    return;
  }

  let body;
  try { body = await readBody(req); }
  catch { res.status(400).json({ error: 'Could not read request body.' }); return; }

  const { imageBase64, imageType = 'image/jpeg' } = body;
  if (!imageBase64) { res.status(400).json({ error: 'No image data in request.' }); return; }

  const started  = Date.now();
  let lastError  = 'All models failed.';

  for (let i = 0; i < MODELS.length; i++) {
    const { id, name, timeoutMs } = MODELS[i];

    // Don't start a new attempt if we're almost out of total budget (9 s)
    if (Date.now() - started > 8500) break;

    try {
      const { status, data } = await groqPost(apiKey, id, imageBase64, imageType, timeoutMs);

      if (status !== 200) {
        const msg = data?.error?.message || `${name} returned HTTP ${status}`;
        throw new Error(msg);
      }

      const raw   = data.choices?.[0]?.message?.content || '';
      const clean = raw.replace(/```json|```/g, '').trim();
      const codes = JSON.parse(clean);

      if (!codes.acx1 || !codes.acx2 || !codes.acx3) {
        throw new Error(`${name} returned incomplete data — try a clearer screenshot`);
      }

      res.status(200).json({
        codes,
        model:       name,
        wasFallback: i > 0,
        ms:          Date.now() - started,
      });
      return;

    } catch (err) {
      lastError = err.message || `${name} failed`;
      console.error(`[azelux] attempt ${i + 1} (${name}): ${lastError}`);
      // continue to next model
    }
  }

  res.status(500).json({ error: lastError });
};
        
