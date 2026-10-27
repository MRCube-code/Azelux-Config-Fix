// Legacy Azelux screenshot code extractor with multi-provider vision fallbacks.
// Configure keys as server-side environment variables; never put keys in browser code.
const https = require('https');

const TIMEOUT_MS = 16000;
const MAX_IMAGE_CHARS = 15_000_000;
const PROMPT = `This is a screenshot from the Azelux Minecraft Bedrock client.\nFind the three config code lines and extract them:\n  acx1@[long digit string]\n  acx2@[long digit string]\n  acx3@[digit string]@[QR code]\n\nReturn ONLY a JSON object — no markdown, no explanation:\n{"acx1":"[digits after acx1@]","acx2":"[digits after acx2@]","acx3":"[digits between acx3@ and the second @]"}\n\nCopy every digit exactly. The image may be dark or use the Minecraft bitmap font.`;

// Keep this list limited to models documented as accepting image input.
// Availability/free quotas can change; all targets are optional fallbacks.
const MODEL_TARGETS = [
  // Google AI Studio / Gemini API. Free-tier availability depends on project and region.
  { provider: 'gemini', id: 'gemini-3.8-flash', name: 'Google AI Studio · Gemini 3.8 Flash', env: 'GEMINI_API_KEY' },
  { provider: 'gemini', id: 'gemini-3.5-flash-lite', name: 'Google AI Studio · Gemini 3.5 Flash-Lite', env: 'GEMINI_API_KEY' },
  { provider: 'gemini', id: 'gemini-3.6-flash', name: 'Google AI Studio · Gemini 3.6 Flash', env: 'GEMINI_API_KEY' },
  { provider: 'gemini', id: 'gemini-3.7-flash', name: 'Google AI Studio · Gemini 3.7 Flash', env: 'GEMINI_API_KEY' },
  { provider: 'gemini', id: 'gemini-3.1-flash-lite', name: 'Google AI Studio · Gemini 3.1 Flash-Lite', env: 'GEMINI_API_KEY' },
  { provider: 'gemini', id: 'gemini-2.5-flash-lite', name: 'Google AI Studio · Gemini 2.5 Flash-Lite (legacy availability)', env: 'GEMINI_API_KEY' },

  // Groq's image-capable model.
  { provider: 'groq', id: 'qwen/qwen3.8-27b', name: 'Groq · Qwen 3.8 27B', env: 'GROQ_API_KEY' },

  // OpenRouter free image-capable models. Inventory and routing can change.
  { provider: 'openrouter', id: 'nvidia/nemotron-3.5-super-vl:free', name: 'OpenRouter · Nemotron 3.5 Super VL Free', env: 'OPENROUTER_API_KEY' },
  { provider: 'openrouter', id: 'google/gemma-4-31b-it:free', name: 'OpenRouter · Gemma 4 31B Free', env: 'OPENROUTER_API_KEY' },
  { provider: 'openrouter', id: 'google/gemma-4-26b-a4b-it:free', name: 'OpenRouter · Gemma 4 26B A4B Free', env: 'OPENROUTER_API_KEY' },
  { provider: 'openrouter', id: 'qwen/qwen3.8-27b:free', name: 'OpenRouter · Qwen 3.8 Free', env: 'OPENROUTER_API_KEY' },
  { provider: 'openrouter', id: 'dots-studio/dots-3-note-preview:free', name: 'OpenRouter · Dots3-Note Preview Free', env: 'OPENROUTER_API_KEY' },
  { provider: 'openrouter', id: 'thinkingmachines/inkling:free', name: 'OpenRouter · Inkling Free', env: 'OPENROUTER_API_KEY' },
  { provider: 'openrouter', id: 'thinkingmachines/inkling-small:free', name: 'OpenRouter · Inkling Small Free', env: 'OPENROUTER_API_KEY' },
  { provider: 'openrouter', id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', name: 'OpenRouter · Nemotron 3 Nano Omni Free', env: 'OPENROUTER_API_KEY' },
  { provider: 'openrouter', id: 'openrouter/free', name: 'OpenRouter · Automatic Free Vision Router', env: 'OPENROUTER_API_KEY' },
];

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let raw = '';
    req.on('data', c => { raw += c.toString(); });
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

function parseCodes(raw, target) {
  const clean = String(raw || '').replace(/```json|```/gi, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('no JSON object in response');
  const codes = JSON.parse(match[0]);
  for (const key of ['acx1', 'acx2', 'acx3']) {
    if (codes[key] === undefined || codes[key] === null || String(codes[key]).trim() === '') {
      throw new Error(`incomplete ${key} code returned`);
    }
    codes[key] = String(codes[key]).trim();
  }
  return { codes, model: target.name, modelId: target.id };
}

function tryModel(target, apiKey, imageBase64, imageType) {
  return new Promise((resolve, reject) => {
    let hostname, path, payload, headers;
    if (target.provider === 'gemini') {
      hostname = 'generativelanguage.googleapis.com';
      path = `/v1beta/models/${encodeURIComponent(target.id)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      payload = JSON.stringify({
        contents: [{ role: 'user', parts: [
          { inlineData: { mimeType: imageType, data: imageBase64 } },
          { text: PROMPT },
        ] }],
        generationConfig: { temperature: 0, maxOutputTokens: 300, responseMimeType: 'application/json' },
      });
      headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
    } else {
      hostname = target.provider === 'groq' ? 'api.groq.com' : 'openrouter.ai';
      path = target.provider === 'groq' ? '/openai/v1/chat/completions' : '/api/v1/chat/completions';
      payload = JSON.stringify({
        model: target.id,
        max_tokens: 300,
        temperature: 0,
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${imageType};base64,${imageBase64}` } },
          { type: 'text', text: PROMPT },
        ] }],
      });
      headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': `Bearer ${apiKey}`,
      };
      if (target.provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://azelux.net';
        headers['X-Title'] = 'Azelux Config Tool';
      }
    }

    const req = https.request({ hostname, path, method: 'POST', headers }, res => {
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
          const raw = target.provider === 'gemini'
            ? (json.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('\n')
            : (typeof json.choices?.[0]?.message?.content === 'string'
              ? json.choices[0].message.content
              : (json.choices?.[0]?.message?.content || []).map(p => p.text || '').join('\n'));
          resolve(parseCodes(raw, target));
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

// Small batches avoid firing every provider at once and exhausting all quotas on one upload.
async function runFallbackBatches(targets, keys, imageBase64, imageType) {
  const batchSize = 3;
  const errors = [];
  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = targets.slice(i, i + batchSize);
    try {
      return await Promise.any(batch.map(target => tryModel(target, keys[target.env], imageBase64, imageType)));
    } catch (err) {
      if (err.errors) errors.push(...err.errors.map(e => e.message));
      else errors.push(err.message);
    }
  }
  throw new Error(errors.join(' | ') || 'All models failed or timed out.');
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
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };
  const activeTargets = MODEL_TARGETS.filter(target => keys[target.env]);
  if (!activeTargets.length) {
    res.status(500).json({ error: 'Set at least one of GROQ_API_KEY, OPENROUTER_API_KEY, or GEMINI_API_KEY in your hosting environment.' });
    return;
  }

  let body;
  try { body = await readBody(req); }
  catch { res.status(400).json({ error: 'Could not read request body.' }); return; }
  const { imageBase64, imageType = 'image/jpeg' } = body;
  if (!imageBase64) { res.status(400).json({ error: 'No image data in request.' }); return; }
  if (typeof imageBase64 !== 'string' || imageBase64.length > MAX_IMAGE_CHARS) {
    res.status(413).json({ error: 'Image is too large. Please upload a smaller screenshot.' }); return;
  }
  if (!/^image\/(jpeg|png|webp|gif)$/i.test(imageType)) {
    res.status(400).json({ error: 'Unsupported image type. Upload a JPEG, PNG, WEBP, or GIF screenshot.' }); return;
  }

  const started = Date.now();
  try {
    const result = await runFallbackBatches(activeTargets, keys, imageBase64, imageType);
    res.status(200).json({ codes: result.codes, model: result.model, modelId: result.modelId, ms: Date.now() - started });
  } catch (error) {
    const detail = error.message || 'All models failed or timed out.';
    console.error('[azelux] all vision models failed:', detail);
    res.status(503).json({
      error: 'All configured vision models are busy, rate-limited, unavailable, or unable to read this screenshot. Try again or use the V2 QR decoder on saving.html.',
      detail,
      providersConfigured: [...new Set(activeTargets.map(target => target.provider))],
      modelsTried: activeTargets.length,
    });
  }
};
