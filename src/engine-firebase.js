// Real engine: Firebase AI Logic hybrid inference (Chrome Prompt API on-device + Gemini in the cloud).
import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from 'firebase/ai';
import { getRemoteConfig, fetchAndActivate, getValue } from 'firebase/remote-config';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, orderBy, limit, getDocs, serverTimestamp } from 'firebase/firestore';
import { DEFAULT_CONFIG } from './router.js';
import { ENTITY_SCHEMA } from './airlock.js';

export function hasFirebaseConfig(env) {
  return Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_APP_ID);
}

async function fileToPart(file) {
  const data = await new Promise((resolve) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result).split(',')[1]);
    r.readAsDataURL(file);
  });
  return { inlineData: { data, mimeType: file.type } };
}

export async function createFirebaseEngine(env) {
  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  });

  // App Check is required by Firebase AI Logic. In local dev the debug provider is used;
  // the debug token is printed in the console and must be registered in the Firebase console.
  if (env.DEV || env.VITE_APPCHECK_DEBUG === 'true') self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  initializeAppCheck(app, {
    // Fraud Defense (reCAPTCHA Enterprise) is preferred; reCAPTCHA v3 classic is deprecated in App Check.
    provider: env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY
      ? new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY)
      : new ReCaptchaV3Provider(env.VITE_RECAPTCHA_V3_SITE_KEY || 'debug'),
    isTokenAutoRefreshEnabled: true,
  });

  // Remote Config: routing thresholds can be tuned without redeploying.
  const config = { ...DEFAULT_CONFIG };
  try {
    const rc = getRemoteConfig(app);
    rc.settings.minimumFetchIntervalMillis = 3600000;
    rc.defaultConfig = { max_local_tokens: DEFAULT_CONFIG.maxLocalTokens, cloud_model: DEFAULT_CONFIG.cloudModel, strict_local_default: false };
    await fetchAndActivate(rc);
    config.maxLocalTokens = getValue(rc, 'max_local_tokens').asNumber() || config.maxLocalTokens;
    config.cloudModel = getValue(rc, 'cloud_model').asString() || config.cloudModel;
    config.strictLocalDefault = getValue(rc, 'strict_local_default').asBoolean();
  } catch (e) { console.warn('Remote Config unavailable, using defaults', e); }

  const ai = getAI(app, { backend: new GoogleAIBackend() });

  // Raw (unredacted) text only ever goes to ONLY_ON_DEVICE models: if the local model is
  // missing they throw instead of silently falling back to the cloud.
  const localModel = getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE });
  const cloudModel = getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams: { model: config.cloudModel } });
  const groundedModel = getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams: { model: config.cloudModel, tools: [{ googleSearch: {} }] } });
  const detectModel = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: { promptOptions: { responseConstraint: ENTITY_SCHEMA } },
  });

  let deviceReady = false;
  const auth = getAuth(app);
  const db = getFirestore(app);

  return {
    kind: 'firebase',
    config,
    async availability() {
      if (typeof LanguageModel === 'undefined') return 'unavailable';
      try { return await LanguageModel.availability(); } catch { return 'unavailable'; }
    },
    async localAvailable() { return deviceReady && (await this.availability()) === 'available'; },
    // Must be called from a user gesture (button click).
    async initDevice(onProgress) {
      await localModel.initializeDeviceModel(onProgress);
      await detectModel.initializeDeviceModel();
      deviceReady = true;
    },
    async local(prompt, { schema, image } = {}) {
      const model = schema ? detectModel : localModel;
      const parts = image ? [prompt, await fileToPart(image)] : prompt;
      const res = (await model.generateContent(parts)).response;
      if (res.inferenceSource && res.inferenceSource !== 'on_device') throw new Error('Unexpected cloud inference for raw data');
      return { text: res.text(), source: res.inferenceSource || 'on_device' };
    },
    async cloud(prompt, { grounding } = {}) {
      const model = grounding ? groundedModel : cloudModel;
      const res = (await model.generateContent(prompt)).response;
      const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const sources = chunks.map((c) => c.web).filter(Boolean).map((w) => ({ title: w.title, uri: w.uri }));
      return { text: res.text(), source: res.inferenceSource || 'in_cloud', sources };
    },
    async save(entry) {
      if (!auth.currentUser) await signInAnonymously(auth);
      await addDoc(collection(db, 'users', auth.currentUser.uid, 'history'), { ...entry, at: serverTimestamp() });
    },
    async history() {
      if (!auth.currentUser) await signInAnonymously(auth);
      const q = query(collection(db, 'users', auth.currentUser.uid, 'history'), orderBy('at', 'desc'), limit(10));
      return (await getDocs(q)).docs.map((d) => d.data());
    },
  };
}
