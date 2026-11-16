# Airlock — privacy-safe hybrid AI for sensitive documents

**Airlock** helps people understand bank letters, medical reports, tax notices and suspicious SMS with AI
**without handing their personal data to the cloud**. It is built on the **Firebase AI Logic hybrid inference SDK**:
Gemini Nano runs on-device in Chrome; Gemini in the cloud is used only when it is really needed — and then it
only ever receives a *redacted* copy.

## Why
Hybrid inference normally means: *"use the local model, otherwise fall back to the cloud."*
For private documents that fallback is exactly the problem: on a device without a local model, a naive
hybrid app silently uploads your IBAN, ID number and diagnosis. Airlock makes the fallback **privacy-safe**:

1. **Detect** personal data on the device — deterministic, checksum-validated detectors (IBAN mod-97, Spanish DNI/NIE,
   card Luhn, e-mail, phone, address, names after honorifics) **plus** Gemini Nano structured-output extraction (JSON schema).
2. **Route** with an explicit, testable policy (`src/router.js`):
   - fits on-device → the *original* text goes only to an `ONLY_ON_DEVICE` model (0 bytes leave the device);
   - too long for the on-device budget, needs Grounding with Google Search (scam check), or no local model →
     only the **redacted** text goes to an `ONLY_IN_CLOUD` model;
   - offline → on-device or blocked; **Strict mode** → never cloud.
3. **Guard**: `assertNoLeak()` refuses to send if any protected value is still in the outgoing prompt.
4. **Re-fill** placeholders locally (`[PERSON_1]` → real name) so the answer reads naturally.
5. **Show** exactly what left the device and which engine answered (`response.inferenceSource`).
6. **Store** only redacted history (Firestore + Anonymous Auth, owner-only security rules).

Photos of documents (JPEG/PNG) are transcribed **on-device only**; images are never uploaded.

## Firebase products used
| Product | Use |
|---|---|
| Firebase AI Logic (hybrid inference, `firebase/ai`) | `ONLY_ON_DEVICE` for raw data, `ONLY_IN_CLOUD` (+ Google Search grounding) for redacted data, structured output on-device |
| App Check | Required by AI Logic (reCAPTCHA Enterprise in production, debug provider locally) |
| Remote Config | Tunes routing thresholds (`max_local_tokens`, `cloud_model`, `strict_local_default`) without redeploying |
| Authentication (anonymous) + Firestore | Per-user redacted history |
| Hosting | Public demo |

Code: `src/engine-firebase.js` (all Firebase calls), `src/airlock.js` (pipeline), `src/pii.js`, `src/router.js`.

## Run it
Requirements: Node 20+, Chrome Desktop 139+.

```bash
npm install
npm test            # 17 unit tests: detectors, router, pipeline leak checks
npm run dev         # without .env.local the app runs in clearly-labelled DEMO mode (simulated answers)
```

### Connect Firebase (real models)
1. Create a Firebase project → **AI Services › AI Logic › Get started** → choose **Gemini Developer API** (no-cost tier).
2. Register a **Web app**, copy its config into `.env.local` (see `.env.example`).
3. **App Check**: register the web app with **reCAPTCHA Enterprise**, put the site key in `.env.local`.
   For local dev run the app, copy the *debug token* printed in the console and add it in
   **App Check › Apps › Manage debug tokens**. Make sure App Check is *Enforced* for AI Logic.
4. Enable **Authentication › Anonymous** and create a **Firestore** database; deploy rules: `firebase deploy --only firestore:rules`.
5. (Optional) **Remote Config**: import `remoteconfig.template.json`.
6. Chrome: enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`, restart, then click **Enable on-device model** in the app.
7. Deploy: `npm run build && firebase deploy --only hosting`.

### Test the hybrid behaviour
- Chrome with Gemini Nano → *Explain* a letter: route **On-device**, "What left your device" = 0 bytes.
- *Is this legit or a scam?* → route **Cloud with redacted text**, with Google Search sources.
- Another browser / device without Nano → automatic **redacted** cloud fallback.
- DevTools › Network › Offline → still works on-device.
- Smoke test of the UI: `node scripts/smoke.mjs` (headless Chrome, demo mode, fails if raw PII reaches the egress panel).

## Limits
- Detectors focus on EU/Spanish and US formats; names are found by honorific rules + the on-device model.
  Without Nano, a name without honorific could be missed — use **Strict mode** for maximum safety.
- On-device inference is single-turn and limited to ~9k tokens (Chrome Prompt API).

## License
Apache-2.0 — see `LICENSE`. All sample data is fictional.
