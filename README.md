# Azelux Config Tools — V2 QR support

This project keeps the legacy screenshot-repair tool and adds a dedicated `saving.html` page for the Azelux V2 QR workflow.

## What's changed

- **V2 QR decoding:** reads the QR payload directly in the browser instead of sending a screenshot to an AI vision API.
- **Better screenshot handling:** tries a centered crop, a tighter crop, the full image, and an enlarged copy for small screenshots.
- **Payload validation:** looks for the V2 `acx1` prefix and `@@MRxCubic@@acx` ending marker before enabling pack download.
- **Editable raw result:** the payload can be copied or manually pasted if the screenshot decoder cannot read it.
- **Browser-side processing:** QR data and uploaded screenshots are not sent to a server by `saving.html`.
- **Legacy path retained:** `index.html` still contains the older ACX text extractor/manual image generator and links to `saving.html`.

## Deploy

The site is static except for the legacy `/api/extract` function. `saving.html` can be served as a normal static file, for example on Vercel. Keep `api/extract.js` and configure `GROQ_API_KEY` only if you still want to use the legacy screenshot text-extraction feature on `index.html`.

No API key is needed for the V2 QR decoder.

## Important pack-format note

The supplied ZIP did **not** include the source for the existing production `azelux.net/saving.html` page or its established config-pack writer. The new page creates a Bedrock-style `.mcpack` and stores the QR payload in `manifest.json`'s `header.description`, `azelux-config.txt`, and `config/azelux-v2.json`.

That is a documented best-effort format, **not verified against Azelux V2's internal pack reader**. Before replacing the production page, compare the generated manifest/files with a known-good `.mcpack` produced by the current `azelux.net/saving.html` page. If Azelux reads the config from a different manifest property or file path, change the `downloadPack()` function in `saving.html` to match that exact schema. The QR decoding itself is independent of this packaging assumption.

## Local testing

Use a local static server or Vercel preview (do not open the page as `file://`, because CDN imports, object URLs, and download behavior may vary by browser).

1. Open `/saving.html` on a phone or desktop browser.
2. Upload the V2 screenshot with the whole QR code visible.
3. Confirm the decoded text ends in `@@MRxCubic@@acx`.
4. Inspect the downloaded `.mcpack` ZIP and verify its manifest and payload file.
5. Test the pack in a disposable Minecraft world/profile before relying on it for an important config.

## Legacy API configuration

The legacy `/api/extract` endpoint reads `GROQ_API_KEY` from the hosting environment. There is no API key hard-coded in the source.
