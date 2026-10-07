/* ==========================================================================
   F.R.I.D.A.Y. // SERVER LIB — DOCX WRITER (verbatim from vite-plugin-os.js
   /api/save-file handler; lazy-imports the 'docx' package exactly as before)
   ========================================================================== */

import fs from 'fs';

export async function writeDocx(content, fullPath) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');

  const paragraphs = content.split('\n').filter(l => l.trim().length > 0).map(line => {
    if (line.startsWith('# ')) return new Paragraph({ text: line.replace('# ', ''), heading: HeadingLevel.HEADING_1 });
    if (line.startsWith('## ')) return new Paragraph({ text: line.replace('## ', ''), heading: HeadingLevel.HEADING_2 });
    if (line.startsWith('### ')) return new Paragraph({ text: line.replace('### ', ''), heading: HeadingLevel.HEADING_3 });

    // Handle bolding **text** simply
    const parts = line.split(/(\*\*.*?\*\*)/g);
    const children = parts.map(part => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return new TextRun({ text: part.slice(2, -2), bold: true });
      }
      return new TextRun(part);
    });
    return new Paragraph({ children });
  });

  const doc = new Document({
    sections: [{ properties: {}, children: paragraphs }]
  });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(fullPath, buffer);
}
