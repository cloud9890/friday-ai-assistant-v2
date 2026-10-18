/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — CREATE DOCUMENT (.docx on the Desktop)
   ========================================================================== */

import path from 'path';
import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { desktopDir } from '../lib/paths.js';
import { launchInInteractiveSession } from '../lib/app-launcher.js';
import { writeDocx } from '../lib/docx-writer.js';

/** The exact .docx destination — shared so execute() and the kernel agree. */
function documentPath(topic) {
  const safe = String(topic || 'Document').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 60);
  let full = path.join(desktopDir, `Document_${safe}`);
  if (!full.endsWith('.docx')) full += '.docx';
  return full;
}

export default {
  name: 'create_document',
  description: 'Drafts a long-form document and saves it as .docx on the Desktop.',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string' },
      originalRequest: { type: 'string' }
    },
    required: ['topic', 'originalRequest']
  },
  risk: RISK.HIGH,
  permissions: [PERMISSION.WRITE_FILES, PERMISSION.LAUNCH_PROCESS, PERMISSION.MODEL_INVOKE],
  confirmation: CONFIRMATION.NONE,

  // M6: WRITE_FILES was declared but no hints were supplied, so the write
  // policy branch was a no-op that only *looked* enforced. Declaring the real
  // destination makes the kernel validate what will actually be written.
  policyHints(args) {
    const full = documentPath(args.topic);
    return { __fileName: path.basename(full), __targetPath: full };
  },

  async execute(args, ctx) {
    const prompt = `You have been asked to generate a document/essay. Topic: "${args.topic}". User request details: "${args.originalRequest}". Fulfil the request exactly as specified. Structure it with markdown headings (#, ##) and optional **bold**.`;
    const generated = await ctx.chat({ messages: [{ role: 'user', content: prompt }], max_tokens: 4000, temperature: 0.6 });
    if (!generated.ok || !generated.reply) return 'Error: the document could not be generated.';
    const content = generated.reply.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim();
    const full = documentPath(args.topic);
    await writeDocx(content, full);
    launchInInteractiveSession(full);
    return `Composed the document on "${args.topic}" and saved it to ${full}.`;
  }
};
