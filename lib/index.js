/**
 * dsh-security-manager — Host half.
 *
 * Scope: what DSH does not already provide. Plugin listing / enable state /
 * fiber phase belong to the official inventory, so this plugin consumes it
 * (`pluginInventory`) instead of re-deriving it from the Loader. What remains
 * here is the security work: static audit, supply-chain source location,
 * update-impact preview, and snapshot-backed update / rollback.
 *
 * Routes (same-origin JSON):
 *   GET  /api/security-manager/audit            — per-plugin risk findings + score
 *   GET  /api/security-manager/snapshots        — snapshot history
 *   POST /api/security-manager/snapshot         — create a snapshot
 *   POST /api/security-manager/update-check     — npm metadata (latest + repository)
 *   POST /api/security-manager/update-preview   — risk diff for a candidate version
 *   POST /api/security-manager/update           — update (snapshot first)
 *   POST /api/security-manager/rollback         — restore a whole snapshot
 *   POST /api/security-manager/snapshot-diff    — what changed since a snapshot
 *   POST /api/security-manager/rollback-package — roll back one package only
 *
 * Configuration (cordis patch config):
 *   home:      DSH home directory (default: $DSH_HOME or ~/.dsh)
 *   profile:   profile name (default: web)
 *   pnpmPath:  pnpm executable (default: pnpm; absolute path for portables)
 *   scan:      enable the static capability scan (default true)
 */
import z from '@deepseek-ai/schemastery';
import {
  MANAGED,
  resolveHome,
  profileDir,
  discoverPackages,
  inspectPackage,
  makeSnapshot,
  listSnapshots,
  updatePackage,
  rollbackSnapshot,
  diffSnapshot,
  rollbackPackage,
} from './manager.js';
import { auditAll, previewUpdate } from './audit.js';

/** Cordis plugin name used by loader diagnostics. */
export const name = 'security-manager';
/** Host half needs the web server; the inventory is an optional enrichment. */
export const inject = ['webServer'];

/** Plugin config schema. */
export const Config = z.object({
  home: z.string().default(''),
  profile: z.string().default('web'),
  pnpmPath: z.string().default('pnpm'),
  scan: z.boolean().default(true),
});

function homeOf(config) {
  return resolveHome(config.home);
}

/** Small JSON helpers. */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.statusCode = status;
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text.length === 0 ? {} : JSON.parse(text));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function packageArg(body) {
  const pkg = String(body && body.package ? body.package : '');
  return pkg ? pkg : null;
}

function stringArg(body, key) {
  const value = body && body[key] !== undefined && body[key] !== null ? String(body[key]) : '';
  return value === '' ? null : value;
}

/**
 * Read the official plugin inventory. Optional: when it is unavailable the
 * audit simply reports no runtime correlation instead of failing.
 */
async function readInventory(ctx) {
  const inventory = ctx.get('pluginInventory');
  if (inventory === undefined || typeof inventory.list !== 'function') return null;
  try {
    const snapshot = await inventory.list();
    const entries = Array.isArray(snapshot && snapshot.entries) ? snapshot.entries : [];
    return { entries };
  } catch {
    return null;
  }
}

/** Wrap an async handler with uniform JSON error reporting. */
function route(webServer, path, handler, disposers) {
  disposers.push(
    webServer.register({
      kind: 'exact',
      path,
      handler: async (req, res) => {
        try {
          await handler(req, res);
        } catch (e) {
          sendJson(res, 400, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      },
    }),
  );
}

/** Register the routes. Returns a disposer. */
function registerRoutes(ctx, webServer, config) {
  const disposers = [];
  const home = homeOf(config);
  const profile = config.profile;
  const pnpmPath = config.pnpmPath;
  const scan = config.scan !== false;
  const dir = profileDir(home, profile);

  // --- read-only: static audit (local files only, no network) ---
  route(
    webServer,
    '/api/security-manager/audit',
    async (_req, res) => {
      const runtime = await readInventory(ctx);
      const result = auditAll(home, profile, { runtime, scan });
      sendJson(res, 200, {
        ok: true,
        home,
        profile,
        profileDir: dir,
        generatedAt: new Date().toISOString(),
        summary: result.summary,
        items: result.items,
        runtimeAvailable: runtime !== null,
        managed: Object.keys(MANAGED),
      });
    },
    disposers,
  );

  route(webServer, '/api/security-manager/snapshots', async (_req, res) => {
    sendJson(res, 200, { ok: true, snapshots: listSnapshots(home, profile) });
  }, disposers);

  route(webServer, '/api/security-manager/snapshot', async (req, res) => {
    const body = await readJsonBody(req);
    const label = stringArg(body, 'label') ?? 'manual';
    const s = makeSnapshot(home, profile, label);
    sendJson(res, 200, { ok: true, snapshot: s.dir, copied: s.copied });
  }, disposers);

  route(webServer, '/api/security-manager/snapshot-diff', async (req, res) => {
    const body = await readJsonBody(req);
    const snapshot = stringArg(body, 'snapshot');
    if (!snapshot) {
      sendJson(res, 400, { ok: false, error: 'snapshot required' });
      return;
    }
    sendJson(res, 200, { ok: true, ...diffSnapshot(home, profile, snapshot) });
  }, disposers);

  // --- network: published metadata + risk preview ---
  route(webServer, '/api/security-manager/update-check', async (req, res) => {
    const body = await readJsonBody(req);
    const pkg = packageArg(body);
    if (!pkg) {
      sendJson(res, 400, { ok: false, error: 'package required' });
      return;
    }
    sendJson(res, 200, { ok: true, ...(await inspectPackage(home, profile, pkg)) });
  }, disposers);

  route(webServer, '/api/security-manager/update-preview', async (req, res) => {
    const body = await readJsonBody(req);
    const pkg = packageArg(body);
    if (!pkg) {
      sendJson(res, 400, { ok: false, error: 'package required' });
      return;
    }
    let version = stringArg(body, 'version');
    if (!version) {
      const info = await inspectPackage(home, profile, pkg);
      version = info.latest;
    }
    if (!version) {
      sendJson(res, 200, { ok: false, error: `no published version found for ${pkg}` });
      return;
    }
    const result = await previewUpdate(home, profile, pkg, version);
    sendJson(res, result.ok ? 200 : 200, result);
  }, disposers);

  // --- mutating: update / rollback (snapshot first) ---
  route(webServer, '/api/security-manager/update', async (req, res) => {
    const body = await readJsonBody(req);
    const pkg = packageArg(body);
    if (!pkg) {
      sendJson(res, 400, { ok: false, error: 'package required' });
      return;
    }
    const result = await updatePackage(home, profile, pnpmPath, pkg, stringArg(body, 'version'), stringArg(body, 'ref'));
    sendJson(res, result.ok ? 200 : 500, result);
  }, disposers);

  route(webServer, '/api/security-manager/rollback', async (req, res) => {
    const body = await readJsonBody(req);
    const snapshot = stringArg(body, 'snapshot');
    if (!snapshot) {
      sendJson(res, 400, { ok: false, error: 'snapshot required' });
      return;
    }
    const result = await rollbackSnapshot(home, profile, pnpmPath, snapshot);
    sendJson(res, result.ok ? 200 : 500, result);
  }, disposers);

  route(webServer, '/api/security-manager/rollback-package', async (req, res) => {
    const body = await readJsonBody(req);
    const pkg = packageArg(body);
    const snapshot = stringArg(body, 'snapshot');
    if (!pkg || !snapshot) {
      sendJson(res, 400, { ok: false, error: 'package and snapshot required' });
      return;
    }
    const result = await rollbackPackage(home, profile, pnpmPath, pkg, snapshot);
    sendJson(res, result.ok ? 200 : 500, result);
  }, disposers);

  return () => {
    for (const dispose of disposers) dispose();
  };
}

/** Plugin body. Config arrives as the second argument (cordis 4 convention). */
export function apply(ctx, config) {
  const webServer = ctx.get('webServer');
  if (webServer === undefined) return;
  return registerRoutes(ctx, webServer, config ?? {});
}

export { discoverPackages };
