# Azelux Config Tools — V2 QR support

This project keeps the legacy screenshot-repair tool and adds a dedicated `saving.html` page for the Azelux V2 QR workflow.

## What's changed

- **V2 QR decoding:** reads the QR payload directly in the browser instead of sending a screenshot to an AI vision API.
- **Better screenshot handling:** tries a centered crop, a tighter crop, the full image, and an enlarged copy for small screenshots.
- **Payload validation:** looks for the V2 `acx1` prefix and `@@MRxCubic@@acx` ending marker before enabling pack download.
- **Editable raw result:** the payload can be copied or manually pasted if the screenshot decoder cannot read it.
- **Browser-side processing:** QR data and uploaded screenshots are not sent to a server by `saving.html`.
- **High-resolution QR regeneration:** creates a 1024px PNG from the exact decoded payload with high error correction, for uploading to the original Azelux QR-only page. The payload is preserved byte-for-byte; a QR image cannot repair an incompatible payload format.
- **Legacy path retained:** `index.html` still contains the older ACX text extractor/manual image generator and links to `saving.html`.

## Deploy

The site is static except for the legacy `/api/extract` function. `saving.html` can be served as a normal static file, for example on Vercel.

### Vision-model fallback setup (OpenRouter + Google AI Studio + Groq)

The legacy `/api/extract` endpoint now supports three server-side providers. It tries configured image-capable models in small batches so a single upload does not immediately fire every model request at once.

**Google AI Studio / Gemini API** — configure `GEMINI_API_KEY`:
- `gemini-3.8-flash`
- `gemini-3.5-flash-lite`
- `gemini-3.6-flash`
- `gemini-3.7-flash`
- `gemini-3.1-flash-lite`
- `gemini-2.5-flash-lite` (legacy availability; may be restricted for new projects)

**OpenRouter** — configure `OPENROUTER_API_KEY`:
- `nvidia/nemotron-3.5-super-vl:free`
- `google/gemma-4-31b-it:free`
- `google/gemma-4-26b-a4b-it:free`
- `qwen/qwen3.8-27b:free`
- `dots-studio/dots-3-note-preview:free`
- `thinkingmachines/inkling:free`
- `thinkingmachines/inkling-small:free`
- `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`
- `openrouter/free` (automatic free-model router; availability/vision routing can vary)

**Groq** — configure `GROQ_API_KEY`:
- `qwen/qwen3.8-27b`

Add any or all of these keys in Vercel Project Settings → Environment Variables, then redeploy. The key names must be exactly `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, and/or `GROQ_API_KEY`. Do not paste keys into `index.html`, `saving.html`, or commit them to GitHub. Gemini's free-tier quota depends on the project, region, model, and current Google limits; OpenRouter free endpoints can also be busy or rate-limited. Adding more model choices improves fallback odds but cannot guarantee capacity or that a provider keeps a model free. Model IDs and availability change over time; verify them in the providers' model catalogues if a model begins returning 404/unsupported errors.

The V2 QR decoder and QR generator on `saving.html` run in the browser and do not need any API key. The AI keys are only for the legacy screenshot-to-text extractor on `index.html`.

## Important pack-format note

The supplied ZIP did **not** include the source for the existing production `azelux.net/saving.html` page or its established config-pack writer. The new page creates a Bedrock-style `.mcpack` and stores the QR payload in `manifest.json`'s `header.description`, `azelux-config.txt`, and `config/azelux-v2.json`.

That is a documented best-effort format, **not verified against Azelux V2's internal pack reader**. Before replacing the production page, compare the generated manifest/files with a known-good `.mcpack` produced by the current `azelux.net/saving.html` page. If Azelux reads the config from a different manifest property or file path, change the `downloadPack()` function in `saving.html` to match that exact schema. The QR decoding itself is independent of this packaging assumption.

## Local testing

Use a local static server or Vercel preview (do not open the page as `file://`, because CDN imports, object URLs, and download behavior may vary by browser).

1. Open `/saving.html` on a phone or desktop browser.
2. Upload the V2 screenshot with the whole QR code visible.
3. Confirm the decoded text ends in `@@MRxCubic@@acx`.
4. Generate and download the high-resolution QR PNG if you need to submit the exact payload to the original QR-only Azelux page.
5. Inspect the downloaded `.mcpack` ZIP and verify its manifest and payload file.
6. Test the pack in a disposable Minecraft world/profile before relying on it for an important config.

## Legacy API configuration

The legacy `/api/extract` endpoint reads `GROQ_API_KEY`, `OPENROUTER_API_KEY`, and `GEMINI_API_KEY` from hosting environment variables. There are no API keys hard-coded in the source.
