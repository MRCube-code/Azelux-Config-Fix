// Azelux legacy screenshot extractor.
// Uses currently supported vision models and optional OpenRouter free-model fallbacks.
// Configure GROQ_API_KEY and optionally OPENROUTER_API_KEY in the hosting environment.

const https = require('https');

const TIMEOUT_MS = 10000;
const PROMPT = `This is a screenshot from the Azelux Minecraft Bedrock client.\nFind the three config code lines and extract them:\n  acx1@[long digit string]\n  acx2@[long digit string]\n  acx3@[digit string]@[QR code]\n\nReturn ONLY a JSON object — no markdown, no explanation:\n{"acx1":"[digits after acx1@]","acx2":"[digits after acx2@]","acx3":"[digits between acx3@ and the second @]"}\n\nCopy every digit exactly. The image may be dark or use the Minecraft bitmap font.`;

// Model IDs that support image input. Free-tier capacity and model availability can change.
const MODEL_TARGETS = [
  { provider: 'groq', id: 'qwen/qwen3.8-27b', name: 'Groq · Qwen 3.8 27B', env: 'GROQ_API_KEY' },
  { provider: 'openrouter', id: 'google/gemma-4-31b-it:free', name: 'OpenRouter · Gemma 4 31B Free', env: 'OPENROUTER_API_KEY' },
  { provider: 'openrouter', id: 'google/gemma-4-26b-a4b-it:free', name: 'OpenRouter · Gemma 4 26B Free', env: 'OPENROUTER_API_KEY' },
  { provider: 'openrouter', id: 'nvidia/nemotron-3.5-super-vl:free', name: 'OpenRouter · Nemotron Super VL Free', env: 'OPENROUTER_API_KEY' },
  { provider: 'openrouter', id: 'qwen/qwen3.8-27b:free', name: 'OpenRouter · Qwen 3.8 Free', env: 'OPENROUTER_API_KEY' },
];

const PROVIDERS = {
  groq: { hostname: 'api.groq.com', path: '/openai/v1/chat/completions' },
  openrouter: { hostname: 'openrouter.ai', path: '/api/v1/chat/completions' },
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let raw = '';
    req.on('data', c => { raw += c.toString(); });
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

function tryModel(target, apiKey, imageBase64, imageType) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: target.id,
      max_tokens: 300,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${imageType};base64,${imageBase64}` } },
          { type: 'text', text: PROMPT },
        ],
      }],
    });
    const provider = PROVIDERS[target.provider];
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'Authorization': `Bearer ${apiKey}`,
    };
    if (target.provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://azelux.net';
      headers['X-Title'] = 'Azelux Config Tool';
    }
    const req = https.request({ hostname: provider.hostname, path: provider.path, method: 'POST', headers }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); }
        catch { reject(new Error(`${target.name}: provider returned non-JSON (HTTP ${res.statusCode})`)); return; }
        if (res.statusCode < 200 || res.statusCode >= 300 || json.error) {
          const message = json.error?.message || json.message || `HTTP ${res.statusCode}`;
          reject(new Error(`${target.name}: ${message}`));
          return;
        }
        try {
          const raw = json.choices?.[0]?.message?.content || '';
          const clean = raw.replace(/```json|```/g, '').trim();
          const match = clean.match(/\{[\s\S]*\}/);
          if (!match) throw new Error('no JSON object in response');
          const codes = JSON.parse(match[0]);
          if (!codes.acx1 || !codes.acx2 || !codes.acx3) throw new Error('incomplete codes returned');
          resolve({ codes, model: target.name, modelId: target.id });
        } catch (error) { reject(new Error(`${target.name}: ${error.message}`)); }
      });
    });
    req.on('error', error => reject(new Error(`${target.name}: ${error.message}`)));
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error(`${target.name}: timed out after ${TIMEOUT_MS}ms`));
    });
    req.write(payload);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end('{}'); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const keys = {
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  };
  const activeTargets = MODEL_TARGETS.filter(target => keys[target.env]);
  if (!activeTargets.length) {
    res.status(500).json({ error: 'Set GROQ_API_KEY and/or OPENROUTER_API_KEY in the hosting environment.' });
    return;
  }

  let body;
  try { body = await readBody(req); }
  catch { res.status(400).json({ error: 'Could not read request body.' }); return; }
  const { imageBase64, imageType = 'image/jpeg' } = body;
  if (!imageBase64) { res.status(400).json({ error: 'No image data in request.' }); return; }
  if (typeof imageBase64 !== 'string' || imageBase64.length > 15_000_000) {
    res.status(413).json({ error: 'Image is too large. Please upload a smaller screenshot.' }); return;
  }

  const started = Date.now();
  try {
    const result = await Promise.any(activeTargets.map(target => tryModel(target, keys[target.env], imageBase64, imageType)));
    res.status(200).json({ codes: result.codes, model: result.model, ms: Date.now() - started });
  } catch (aggregateErr) {
    const reasons = aggregateErr.errors ? aggregateErr.errors.map(e => e.message).join(' | ') : 'All models failed or timed out.';
    console.error('[azelux] all vision models failed:', reasons);
    res.status(503).json({
      error: 'All configured free vision models are busy, rate-limited, or unavailable. Wait briefly and retry.',
      detail: reasons,
      providersConfigured: [...new Set(activeTargets.map(target => target.provider))],
    });
  }
};
