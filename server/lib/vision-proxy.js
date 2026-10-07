/* ==========================================================================
   F.R.I.D.A.Y. // SERVER LIB — GROQ MULTIMODAL VISION PROXY
   Logic extracted VERBATIM from the inline /api/vision handler in
   vite-plugin-os.js so the web-agent screenshot analysis can reuse it.
   ========================================================================== */

import fs from 'fs';
import path from 'path';

function resolveGroqKey() {
  let apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    try {
      const envContent = fs.readFileSync(path.resolve('.env'), 'utf-8');
      const match = envContent.match(/(?:^|\n)GROQ_API_KEY=(.*)/);
      if (match) apiKey = match[1].trim();
    } catch (e) {}
  }
  return apiKey;
}

const VISION_MODEL = process.env.VISION_MODEL || 'qwen/qwen3.8-27b';

/**
 * Runs a Groq vision analysis on an image data URL.
 * Returns the raw OpenAI-compatible JSON response (same shape /api/vision
 * returned before): { choices: [{ message: { content } }] }.
 * Throws on missing key or non-OK provider response.
 */
export async function runVisionAnalysis({ image_url, text, system_prompt }) {
  const apiKey = resolveGroqKey();
  if (!apiKey) throw new Error('Server missing Groq API key');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: system_prompt || "You are a helpful AI assistant." },
        {
          role: "user",
          content: [
            { type: "text", text: text || "Analyze this screenshot." },
            { type: "image_url", image_url: { url: image_url } }
          ]
        }
      ],
      temperature: 0.3,
      max_tokens: 2048
    }),
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Vision proxy HTTP ${response.status}: ${errText}`);
  }
  return await response.json();
}