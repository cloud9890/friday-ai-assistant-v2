/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — ANALYZE SCREEN (vision)
   The frame is captured by the HUD (getDisplayMedia) and rides along with the
   agent request while screen sharing is active; here it is analysed by the
   Groq vision proxy.
   ========================================================================== */

import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { runVisionAnalysis } from '../lib/vision-proxy.js';

const SYSTEM_PROMPT = `You are F.R.I.D.A.Y., Tony Stark's advanced tactical AI. Analyze the provided screenshot and respond directly to Boss in 1-3 concise sentences. Focus only on what matters most for the user's request.`;

export default {
  name: 'analyze_screen',
  description: 'Answers a question about the screen; requires SHARE SCREEN enabled in the HUD.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query']
  },
  risk: RISK.MEDIUM,
  permissions: [PERMISSION.SCREEN_CAPTURE, PERMISSION.MODEL_INVOKE],
  confirmation: CONFIRMATION.NONE,

  async execute(args, ctx) {
    const frame = ctx.screenFrame;
    if (!frame) {
      return "I don't have access to your screen yet, Boss. Turn on SHARE SCREEN in the top bar first, then ask me again.";
    }
    const data = await runVisionAnalysis({ image_url: frame, text: args.query, system_prompt: SYSTEM_PROMPT });
    const answer = data?.choices?.[0]?.message?.content?.trim();
    return answer || 'I looked at your screen but could not make out an answer to that.';
  }
};
