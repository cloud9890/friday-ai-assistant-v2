/* ==========================================================================
   F.R.I.D.A.Y. // SERVER LIB — GROQ MODEL REGISTRY
   Automated tool-calling model probe (verbatim logic from vite-plugin-os.js
   /api/chat handler; process-global cache replaced by module state).
   ========================================================================== */

let cachedValidModel = null;
let groqProbePromise = null;

/**
 * Probes the Groq account for a model that supports OpenAI-style tool calling.
 * Mirrors the original inline probe exactly:
 *  - fetches /models with the chat headers
 *  - skips whisper/vision/guard models
 *  - POSTs a tiny tool-calling probe per candidate (8s timeout)
 *  - returns null on failure (caller falls back)
 *  - result cached for the lifetime of the process (same as before)
 */
export async function ensureValidGroqModel(headers, chatUrl, fallbackModel) {
  if (!cachedValidModel) {
    if (!groqProbePromise) {
      groqProbePromise = (async () => {
        console.log("⏳ F.R.I.D.A.Y. is testing Groq models...");
        try {
          const modelsRes = await fetch('https://api.groq.com/openai/v1/models', {
            headers, signal: AbortSignal.timeout(8000)
          });
          if (modelsRes.ok) {
            const modelsData = await modelsRes.json();
            const availableModels = modelsData.data.map(m => m.id);
            for (const model of availableModels) {
              if (model.includes('whisper') || model.includes('vision') || model.includes('guard')) continue;
              const testRes = await fetch(chatUrl, {
                method: 'POST', headers,
                body: JSON.stringify({
                  model: model, messages: [{ role: 'user', content: 'test' }], max_tokens: 10,
                  tools: [{ type: "function", function: { name: "test", description: "test", parameters: { type: "object", properties: {}, required: [] } } }]
                }),
                signal: AbortSignal.timeout(8000)
              });
              if (testRes.ok) {
                console.log(`✅ Found compatible Groq model: ${model}`);
                return model;
              }
            }
          }
        } catch(e) {}
        return null;
      })();
    }
    cachedValidModel = (await groqProbePromise) || fallbackModel;
  }
  return cachedValidModel;
}
