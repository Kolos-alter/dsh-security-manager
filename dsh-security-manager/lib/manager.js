/**
 * dsh-security-manager — core manager (self-contained, publishable).
 *
 * Snapshot / update / rollback logic for managed security plugins in a DSH
 * profile. Pure Node: no cordis, no hard-coded machine paths. Testable
 * standalone: `node lib/manager.js --self-test`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { execFile } from 'node:child_process';

/** Managed security package names (source of truth; also in README). */
export const MANAGED = {
  'dsh-security-guard': '安全守卫',
  'dsh-mcpguard': 'MCP 注入扫描',
  'secret-guard': '密钥守卫',
  'dsh-plugin-gate': '安装审查门',
  'dsh-guardian': '运行时护栏',
};

const SNAP_DIR = '.security-snapshots';
const PROTECTED_FILES = ['package.json', 'cordis.patch.yml', 'pnpm-lock.yaml'];

// ---------- auto-discovery: every installed package + its source ----------

/** Read one installed package's package.json from the profile node_modules. */
function readInstalledManifest(home, profile, packageName) {
  try {
    const p = path.join(profileDir(home, profile), 'node_modules', packageName, 'package.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** Parse a repository spec into a GitHub owner/repo when it points at GitHub. */
export function githubRepoOf(repository) {
  if (typeof repository === 'string') repository = { url: repository };
  if (!repository || typeof repository.url !== 'string') return null;
  const m = /github\.com[:/]([^/]+)\/([^/#.]+)/.exec(repository.url);
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
}

/** Discover every direct dependency of the profile (the installed plugin set). */
export function discoverPackages(home, profile) {
  let dependencies = {};
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(profileDir(home, profile), 'package.json'), 'utf8'));
    dependencies = manifest.dependencies ?? {};
  } catch {
    /* profile without dependencies */
  }
  const out = [];
  for (const name of Object.keys(dependencies)) {
    const manifest = readInstalledManifest(home, profile, name);
    const repository = manifest && manifest.repository;
    const github = githubRepoOf(repository);
    out.push({
      package: name,
      installed: manifest ? (manifest.version ?? null) : null,
      repository: repository ? (typeof repository === 'string' ? repository : repository.url) : null,
      github: github,
      source: github ? (manifest ? 'github' : 'unknown') : 'unknown',
      homepage: manifest && manifest.homepage ? manifest.homepage : null,
    });
  }
  return out;
}

/** Fetch npm metadata for a package: latest version + repository, or null when unpublished. */
export function fetchNpmMetadata(packageName) {
  return new Promise((resolve) => {
    const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
    const req = https.get(url, { headers: { 'user-agent': 'dsh-security-manager' } }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          resolve(null);
          return;
        }
        try {
          const data = JSON.parse(body);
          resolve({
            latest: data['dist-tags']?.latest ?? null,
            repository: data.repository ? (typeof data.repository === 'string' ? data.repository : data.repository.url) : null,
            homepage: data.homepage ?? null,
          });
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(30000, () => req.destroy());
  });
}

/** Enrich one package with its npm presence and GitHub repository. */
export async function inspectPackage(home, profile, packageName) {
  const local = discoverPackages(home, profile).find((p) => p.package === packageName) ?? {
    package: packageName,
    installed: installedVersion(home, profile, packageName),
    repository: null,
    github: null,
    source: 'unknown',
    homepage: null,
  };
  const npm = await fetchNpmMetadata(packageName);
  const github = githubRepoOf(local.repository) || (npm && npm.repository ? githubRepoOf(npm.repository) : null);
  return {
    ...local,
    github,
    latest: npm ? npm.latest : null,
    onNpm: !!npm,
    source: npm ? (github ? 'npm+github' : 'npm') : github ? 'github' : 'unknown',
  };
}

/** Resolve the DSH home: explicit config > DSH_HOME env > platform default. */
export function resolveHome(explicit) {
  if (explicit && explicit.trim() !== '') return explicit.trim();
  if (process.env.DSH_HOME && process.env.DSH_HOME.trim() !== '') return process.env.DSH_HOME.trim();
  return path.join(os.homedir(), '.dsh');
}

export function profileDir(home, profile) {
  return path.join(home, 'profiles', profile);
}

export function snapRootOf(home, profile) {
  return path.join(profileDir(home, profile), SNAP_DIR);
}

export function assertManaged(packageName) {
  if (!(packageName in MANAGED)) {
    throw new Error(`package not in managed security list: ${packageName}`);
  }
}

export function installedVersion(home, profile, packageName) {
  try {
    const p = path.join(profileDir(home, profile), 'node_modules', packageName, 'package.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

/** Create a snapshot of the protected profile files. Returns the snapshot dir. */
export function makeSnapshot(home, profile, label = 'manual') {
  const snapRoot = snapRootOf(home, profile);
  fs.mkdirSync(snapRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeLabel = label.replace(/[\\/:*?"<>|]/g, '_');
  const dir = path.join(snapRoot, `${stamp}__${safeLabel}`);
  fs.mkdirSync(dir, { recursive: true });
  const copied = [];
  for (const name of PROTECTED_FILES) {
    const src = path.join(profileDir(home, profile), name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(dir, name));
      copied.push(name);
    }
  }
  let dependencies = {};
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(profileDir(home, profile), 'package.json'), 'utf8'));
    dependencies = manifest.dependencies ?? {};
  } catch {
    /* best effort */
  }
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ createdAt: new Date().toISOString(), profile, dependencies }, null, 2),
  );
  return { dir, copied };
}

export function listSnapshots(home, profile) {
  const snapRoot = snapRootOf(home, profile);
  if (!fs.existsSync(snapRoot)) return [];
  return fs
    .readdirSync(snapRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const dir = path.join(snapRoot, e.name);
      let manifest = {};
      try {
        manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      } catch {
        /* best effort */
      }
      return {
        name: e.name,
        createdAt: manifest.createdAt ?? null,
        dependencies: manifest.dependencies ?? {},
        files: fs.readdirSync(dir).filter((f) => f !== 'manifest.json'),
      };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

export function restoreSnapshot(home, profile, snapshotName) {
  if (!/^[0-9TZ\-_a-zA-Z]+$/.test(snapshotName)) throw new Error(`invalid snapshot name: ${snapshotName}`);
  const dir = path.join(snapRootOf(home, profile), snapshotName);
  if (!fs.existsSync(dir)) throw new Error(`snapshot not found: ${snapshotName}`);
  const restored = [];
  for (const name of PROTECTED_FILES) {
    const src = path.join(dir, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(profileDir(home, profile), name));
      restored.push(name);
    }
  }
  return restored;
}

/** Run pnpm in the profile directory. `pnpmPath` may be an absolute path or a PATH name. */
export function runPnpm(pnpmPath, pnpmArgs, cwd) {
  return new Promise((resolve) => {
    const bin = pnpmPath || 'pnpm';
    // On Windows, execFile of a .cmd shim requires shell:true (or the .cmd name).
    const useShell = process.platform === 'win32' && !/\.(exe|cmd|bat)$/i.test(bin) && !path.isAbsolute(bin);
    execFile(
      bin,
      pnpmArgs,
      { cwd, shell: useShell, windowsHide: true, timeout: 300000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout || '', stderr: stderr || '' });
      },
    );
  });
}

/** Query npm registry for the latest published version (https, Node 18+ safe). */
export async function fetchLatestVersion(packageName) {
  const meta = await fetchNpmMetadata(packageName);
  return meta ? meta.latest : null;
}

/**
 * Update a package: snapshot first, then install from its source.
 * - npm source:  pnpm add <name>[@<version>]
 * - GitHub-only: pnpm add github:<owner>/<repo>[#<ref>]  (version = git ref when given)
 */
export async function updatePackage(home, profile, pnpmPath, packageName, version, ref) {
  const before = installedVersion(home, profile, packageName);
  const snap = makeSnapshot(home, profile, `before-update-${packageName}`);
  const info = await inspectPackage(home, profile, packageName);

  let spec;
  if (info.onNpm) {
    spec = version ? `${packageName}@${version}` : packageName;
  } else if (info.github) {
    spec = `github:${info.github}` + (ref ? `#${ref}` : '');
  } else {
    return { ok: false, error: `cannot locate a source for ${packageName} (no npm package, no GitHub repository)`, snapshot: snap.dir };
  }

  const r = await runPnpm(pnpmPath, ['add', spec], profileDir(home, profile));
  if (r.code !== 0) {
    return { ok: false, error: `pnpm add ${spec} failed (exit ${r.code})`, stdoutTail: r.stdout.slice(-2000), stderrTail: r.stderr.slice(-2000), snapshot: snap.dir };
  }
  return {
    ok: true,
    package: packageName,
    spec,
    before,
    after: installedVersion(home, profile, packageName),
    snapshot: snap.dir,
    pnpmExit: r.code,
    stderrTail: r.stderr.slice(-800),
  };
}

/** Roll back to a snapshot, then reinstall to restore dependency versions. */
export async function rollbackSnapshot(home, profile, pnpmPath, snapshotName) {
  const restored = restoreSnapshot(home, profile, snapshotName);
  const r = await runPnpm(pnpmPath, ['install'], profileDir(home, profile));
  return {
    ok: r.code === 0,
    restored,
    snapshot: snapshotName,
    pnpmExit: r.code,
    stderrTail: r.stderr.slice(-800),
  };
}

// ---- standalone self-test (also usable from the CLI) ----
const __selfTest = process.argv[1] && process.argv[1].endsWith('manager.js') && process.argv.includes('--self-test');
if (__selfTest) {
  const home = resolveHome();
  const profile = 'web';
  const out = {
    ok: true,
    home,
    profile,
    profileDir: profileDir(home, profile),
    managed: Object.keys(MANAGED).map((n) => ({ package: n, installed: installedVersion(home, profile, n) })),
    snapshots: listSnapshots(home, profile),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}
