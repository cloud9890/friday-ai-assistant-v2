/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — ASK MY DOCUMENT (Phase B: KNOWLEDGEABLE)
   Answers a question about ONE file, whether or not it has been indexed:
   extract -> chunk -> rank the question against the chunks -> cite `file:line`.

   The kernel validates the resolved file (INDEX_READ) before this runs, so a
   hostile name like "..\\..\\.env" never reaches the reader (C1).
   ========================================================================== */

import path from 'path';
import fs from 'fs';
import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { resolveParent } from './helpers.js';
import { extractText } from '../lib/extract.js';
import { chunkText } from '../lib/chunker.js';
import { getEmbedder } from '../lib/embeddings.js';
import { rankChunks, formatHit } from '../lib/knowledge.js';

export default {
  name: 'ask_my_document',
  description: 'Answers a question about a single document on the Desktop or in Documents (txt, md, code, PDF, DOCX). Returns the relevant passages with line citations. Use it for "what does my report say about X?" when the file name is known; use search_knowledge when the file is unknown.',
  parameters: {
    type: 'object',
    properties: {
      fileName: { type: 'string' },
      parent: { type: 'string', enum: ['desktop', 'documents'] },
      question: { type: 'string' }
    },
    required: ['fileName', 'parent', 'question']
  },
  risk: RISK.MEDIUM,
  permissions: [PERMISSION.INDEX_READ],
  confirmation: CONFIRMATION.NONE,

  policyHints(args) {
    const dir = resolveParent(args.parent);
    if (!dir) return { __readDirs: [String(args.parent || '')] };
    const fileName = String(args.fileName || '');
    return {
      __fileName: fileName,
      __readDirs: [dir],
      __targetPath: path.join(dir, fileName)
    };
  },

  async execute(args, ctx, hints) {
    const target = hints.__targetPath;
    if (!target) return 'Error: no readable target.';
    if (!fs.existsSync(target)) return `I could not find ${path.basename(target)} in ${args.parent}.`;

    const extracted = await extractText(target);
    if (!extracted.ok) return `I could not read ${path.basename(target)}: ${extracted.note || 'unsupported file'}.`;

    const chunks = chunkText(extracted.text);
    if (!chunks.length) return `${path.basename(target)} has no indexable text.`;

    const question = String(args.question || '').trim();
    const embedder = await getEmbedder();
    const hits = await rankChunks({ chunks, query: question, embedder, topK: 3, sourcePath: target });

    const header = `${path.basename(target)} (${extracted.kind}, ${chunks.length} sections) — best passages for "${question}":`;
    return `${header}\n${hits.map((h, i) => `${i + 1}. ${formatHit(h)}`).join('\n')}`;
  },

  describe(args) {
    return `Answer "${args.question}" from ${args.fileName}.`;
  }
};
