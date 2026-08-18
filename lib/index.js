/**
 * dsh-security-manager — Host half (self-contained, publishable).
 *
 * Auto-discovers installed plugins, locates their npm / GitHub source, and
 * exposes snapshot / update / rollback over webServer JSON routes:
 *   GET  /api/security-manager/status       — discovered plugins + versions + source
 *   GET  /api/security-manager/snapshots    — snapshot history
 *   POST /api/security-manager/snapshot     — create a snapshot
 *   POST /api/security-manager/update-check — npm metadata (latest + repository)
 *   POST /api/security-manager/update       — update (snapshot first; npm or GitHub source)
 *   POST /api/security-manager/rollback     — restore a snapshot
 *
 * Configuration (cordis patch config):
 *   home:      DSH home directory (default: $DSH_HOME or ~/.dsh)
 *   profile:   profile name (default: web)
 *   pnpmPath:  pnpm executable (default: pnpm; absolute path for portables)
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
} from './manager.js';

/** Cordis plugin name used by loader diagnostics. */
export const name = 'security-manager';
/** Host half needs only the web server. */
export const inject = ['webServer'];

/** Plugin config schema. */
export const Config = z.object({
  home: z.string().default(''),
  profile: z.string().default('web'),
  pnpmPath: z.string().default('pnpm'),
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

/** Register the routes. Returns a disposer. */
function registerRoutes(ctx, webServer, config) {
  const disposers = [];
  const home = homeOf(config);
  const profile = config.profile;
  const pnpmPath = config.pnpmPath;
  const dir = profileDir(home, profile);

  disposers.push(webServer.register({
    kind: 'exact',
    path: '/api/security-manager/status',
    handler: async (_req, res) => {
      // Auto-discovery: everything installed in the profile (+ loader state).
      const discovered = discoverPackages(home, profile);
      const loader = ctx.get('loader');
      const loaded = loader && typeof loader.entries === 'function'
        ? [...loader.entries()].filter((e) => e.options && e.options.name).map((e) => ({
            moduleName: e.options.name,
            entryId: e.id,
            enabled: !e.disabled,
            fiberPhase: e.fiber === undefined ? null : ({ 0: 'pending', 1: 'loading', 2: 'active', 3: 'failed', 4: null, 5: 'unloading' }[e.fiber.state] ?? null),
          }))
        : [];
      const items = discovered.map((p) => {
        const entry = loaded.find((e) => e.moduleName === p.package);
        return {
          package: p.package,
          installed: p.installed,
          repository: p.repository,
          github: p.github,
          homepage: p.homepage,
          source: p.source,
          security: p.package in MANAGED,
          securityLabel: MANAGED[p.package] ?? null,
          entryId: entry ? entry.entryId : null,
          enabled: entry ? entry.enabled : null,
          fiberPhase: entry ? entry.fiberPhase : null,
          mounted: !!entry,
        };
      });
      sendJson(res, 200, { ok: true, items, home, profile, profileDir: dir });
    },
  }));

  disposers.push(webServer.register({
    kind: 'exact',
    path: '/api/security-manager/snapshots',
    handler: async (_req, res) => {
      try {
        sendJson(res, 200, { ok: true, snapshots: listSnapshots(home, profile) });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: e.message });
      }
    },
  }));

  disposers.push(webServer.register({
    kind: 'exact',
    path: '/api/security-manager/snapshot',
    handler: async (req, res) => {
      try {
        const body = await readJsonBody(req);
        const label = String(body && body.label ? body.label : 'manual');
        const s = makeSnapshot(home, profile, label);
        sendJson(res, 200, { ok: true, snapshot: s.dir, copied: s.copied });
      } catch (e) {
        sendJson(res, 400, { ok: false, error: e.message });
      }
    },
  }));

  disposers.push(webServer.register({
    kind: 'exact',
    path: '/api/security-manager/update-check',
    handler: async (req, res) => {
      try {
        const body = await readJsonBody(req);
        const pkg = packageArg(body);
        if (!pkg) { sendJson(res, 400, { ok: false, error: 'package required' }); return; }
        const info = await inspectPackage(home, profile, pkg);
        sendJson(res, 200, { ok: true, ...info });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: e.message });
      }
    },
  }));

  disposers.push(webServer.register({
    kind: 'exact',
    path: '/api/security-manager/update',
    handler: async (req, res) => {
      try {
        const body = await readJsonBody(req);
        const pkg = packageArg(body);
        if (!pkg) { sendJson(res, 400, { ok: false, error: 'package required' }); return; }
        const ver = body && body.version ? String(body.version) : null;
        const ref = body && body.ref ? String(body.ref) : null;
        const result = await updatePackage(home, profile, pnpmPath, pkg, ver, ref);
        sendJson(res, result.ok ? 200 : 500, result);
      } catch (e) {
        sendJson(res, 400, { ok: false, error: e.message });
      }
    },
  }));

  disposers.push(webServer.register({
    kind: 'exact',
    path: '/api/security-manager/rollback',
    handler: async (req, res) => {
      try {
        const body = await readJsonBody(req);
        const snap = String(body && body.snapshot ? body.snapshot : '');
        if (!snap) { sendJson(res, 400, { ok: false, error: 'snapshot required' }); return; }
        const result = await rollbackSnapshot(home, profile, pnpmPath, snap);
        sendJson(res, result.ok ? 200 : 500, result);
      } catch (e) {
        sendJson(res, 400, { ok: false, error: e.message });
      }
    },
  }));

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
