// Demo engine used ONLY when no Firebase config is present (local development / UI review).
// Every answer is clearly labelled as simulated. It never calls any network service.
export function createDemoEngine({ local = true } = {}) {
  const mem = [];
  return {
    kind: 'demo',
    config: { maxLocalTokens: 6000, cloudModel: 'simulated', strictLocalDefault: false },
    async availability() { return local ? 'available' : 'unavailable'; },
    async localAvailable() { return local; },
    async initDevice(onProgress) { onProgress && onProgress(1); },
    async local(prompt, { schema } = {}) {
      if (schema) return { text: JSON.stringify({ docType: 'document', entities: [] }), source: 'on_device' };
      return { text: `[SIMULATED on-device answer — connect Firebase for real output]\n${prompt.split('\n')[0]}`, source: 'on_device' };
    },
    async cloud(prompt) {
      const tokens = [...new Set(prompt.match(/\[[A-Z_]+_\d+\]/g) || [])].join(', ');
      return { text: `[SIMULATED cloud answer — connect Firebase for real output]\nThe cloud only saw ${tokens ? tokens.split(", ").length : 0} placeholders (shown here already re-filled locally): ${tokens || "none"}`, source: 'in_cloud' };
    },
    async save(e) { mem.unshift(e); },
    async history() { return mem.slice(0, 10); },
  };
}
