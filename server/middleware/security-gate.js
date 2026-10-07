/* ==========================================================================
   F.R.I.D.A.Y. // MIDDLEWARE — SECURITY GATE
   Phase 1 (S3). Sits in front of every API route. It parses the request body
   once, asks the policy kernel for a decision, and refuses to call the route
   unless the kernel allows it. The model can request; only the kernel authorises.
   ========================================================================== */

import { authorize, resolveWriteTarget } from '../security/kernel.js';
import { metadataForEndpoint, PUBLIC_ENDPOINTS } from '../security/permissions.js';
import { desktopDir, documentsDir, homeDir } from '../lib/paths.js';

const MAX_BODY_BYTES = 8 * 1024 * 1024; // the vision route posts base64 frames

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let done = false;

    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        finish(null);
        try { req.destroy(); } catch {}
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return finish({});
      try {
        finish(JSON.parse(raw));
      } catch {
        finish(null); // malformed JSON: the route's own parser reports it
      }
    });
    req.on('error', () => finish(null));
  });
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

/** Builds the extra policy inputs each endpoint needs. */
function policyContextFor(pathname, body) {
  const ctx = {};

  if (pathname === '/api/save-file' && body && typeof body === 'object') {
    const { fileName, targetFolder = 'Desktop', format = 'txt' } = body;
    if (typeof fileName === 'string') {
      ctx.__fileName = fileName;
      ctx.__targetPath = resolveWriteTarget(fileName, targetFolder, format);
    }
  }

  if (pathname === '/api/search-files' && body && typeof body === 'object') {
    const folder = typeof body.folder === 'string' ? body.folder.toLowerCase() : 'all';
    ctx.__readDirs = folder === 'desktop' ? [desktopDir]
      : folder === 'documents' ? [documentsDir]
      : [desktopDir, documentsDir, homeDir];
  }

  if (pathname === '/api/web-agent') {
    ctx.__viaAgent = true;
  }

  return ctx;
}

/**
 * Returns a connect-style middleware. Install it BEFORE the API routes.
 *
 * Writes the parsed body to `req.__fridayBody` so downstream handlers do not
 * re-read a consumed stream (see server/lib/parse-body.js).
 */
export function createSecurityGate() {
  return async (req, res, next) => {
    const pathname = String(req.url || '').split('?')[0];

    // Only guard the API surface; static assets and the SPA fall through.
    if (!pathname.startsWith('/api/')) return next();
    if (PUBLIC_ENDPOINTS.includes(pathname)) return next();

    const mapped = metadataForEndpoint(pathname);
    if (!mapped) return next(); // unmapped API path: routers below decide

    let body = {};
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      const parsed = await readBody(req);
      if (parsed === null) {
        return sendJson(res, 400, { success: false, error: 'Malformed or oversized request body' });
      }
      req.__fridayBody = parsed;
      body = parsed;
    }

    const decision = authorize({
      tool: mapped.key,
      args: body,
      actor: 'api',
      ...policyContextFor(pathname, body)
    });

    if (decision.decision !== 'allow') {
      console.log(`⛔ F.R.I.D.A.Y. policy denied ${mapped.key}: ${decision.reason}`);
      return sendJson(res, 403, {
        success: false,
        denied: true,
        capability: mapped.key,
        risk: decision.risk,
        error: decision.reason || 'Action denied by policy'
      });
    }

    // The route may legally use the resolved application target.
    if (decision.resolvedApp && body && typeof body === 'object') {
      body.appName = decision.resolvedApp;
    }

    return next();
  };
}