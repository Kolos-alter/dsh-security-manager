/**
 * dsh-security-manager — security audit engine (pure Node, no cordis).
 *
 * Read-only static audit of the plugins installed in a DSH profile:
 *   - supply-chain source: local/git specs, unpinned ranges, lockfile integrity
 *   - install-time execution: preinstall / install / postinstall / prepare
 *   - capability surface: static scan of the plugin's own shipped JS
 *     (child processes, dynamic eval, network egress, file writes, credential reads)
 *   - metadata hygiene: license / repository / version
 *   - runtime correlation: fiber phase reported by the official plugin inventory
 *
 * The audited plugin's code is never executed; only files and metadata are read.
 *
 * Standalone: `node lib/audit.js --self-test`
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { resolveHome, profileDir, discoverPackages } from './manager.js';

/** Severity weights used for the 0..100 score. */
export const SEVERITY_WEIGHT = { high: 25, medium: 10, low: 3, info: 0 };

/** Map a score to a letter grade. */
export function gradeFor(score) {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 55) return 'C';
  return 'D';
}

/**
 * Static capability rules applied to a plugin's own shipped JavaScript.
 *
 * Severity policy: a capability is not a vulnerability. Almost every plugin
 * spawns subprocesses, writes files or calls fetch, so those are reported as
 * `info` inventory (weight 0) instead of alarms — an audit that shouts at every
 * plugin gets ignored. Only patterns that defeat pre-install inspection
 * (dynamic execution) and sensitive-data access carry real weight.
 */
export const CAPABILITY_RULES = [
  {
    id: 'dynamic-exec',
    severity: 'medium',
    title: '动态执行代码',
    detail: '使用 eval / new Function / vm 执行运行时构造的代码，插件行为无法在安装前审计。',
    re: /\bnew\s+Function\s*\(|\beval\s*\(|\bvm\.(?:runIn\w*|compileFunction|Script)\b/,
  },
  {
    id: 'credential-access',
    severity: 'low',
    title: '可访问凭据/设置数据',
    detail: '引用 DSH 凭据或设置文件、用户主目录，具备读取敏感配置的能力。',
    re: /\.credentials\.yaml|\bcredentials\.yaml\b|\bsettings\.yaml\b|\bDSH_HOME\b|\bhomedir\s*\(/,
  },
  {
    id: 'child-process',
    severity: 'info',
    title: '可执行外部进程',
    detail: '可启动子进程（能力清单，非风险判定）。',
    re: /\bchild_process\b|\bexecFile(?:Sync)?\s*\(|\bspawn(?:Sync)?\s*\(/,
  },
  {
    id: 'network-egress',
    severity: 'info',
    title: '可发起网络请求',
    detail: '可访问网络（能力清单，非风险判定）。',
    re: /\bfetch\s*\(|https?\.(?:request|get)\s*\(|net\.(?:connect|Socket)/,
  },
  {
    id: 'fs-write',
    severity: 'info',
    title: '可写入文件系统',
    detail: '可写入文件（能力清单，非风险判定）。',
    re: /\bwriteFile(?:Sync)?\s*\(|\bappendFile(?:Sync)?\s*\(|\brm(?:Sync)?\s*\(|\bunlink(?:Sync)?\s*\(|\bmkdir(?:Sync)?\s*\(/,
  },
];

/** Directories never scanned as "the plugin's own code". */
const SKIP_DIRS = new Set(['node_modules', '.git', '.security-snapshots']);

/** Only files that are actually executed at runtime are scanned. */
const CODE_EXT = new Set(['.js', '.mjs', '.cjs']);

/**
 * Blank out comments while preserving byte length, so match indices (and thus
 * line numbers and snippets) stay valid against the original text.
 *
 * Without this, a plugin's own JSDoc — e.g. a comment that merely *mentions*
 * `eval(...)` or `child_process` — would be reported as a capability, which
 * makes the whole audit untrustworthy. String literals are kept: referencing
 * `.credentials.yaml` in a string is a real signal.
 */
export function maskComments(text) {
  const out = new Array(text.length);
  let state = 'code';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const d = text[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') {
        state = 'line';
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        continue;
      }
      if (c === '/' && d === '*') {
        state = 'block';
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        continue;
      }
      if (c === "'") state = 'sq';
      else if (c === '"') state = 'dq';
      else if (c === '`') state = 'tpl';
      out[i] = c;
      i++;
      continue;
    }
    if (state === 'line') {
      if (c === '\n' || c === '\r') {
        state = 'code';
        out[i] = c;
      } else {
        out[i] = ' ';
      }
      i++;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && d === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        state = 'code';
        continue;
      }
      out[i] = c === '\n' || c === '\r' ? c : ' ';
      i++;
      continue;
    }
    // inside a string/template: copy verbatim, honouring escapes
    out[i] = c;
    if (c === '\\') {
      if (i + 1 < text.length) out[i + 1] = text[i + 1];
      i += 2;
      continue;
    }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = 'code';
    i++;
  }
  return out.join('');
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * Statically scan one directory tree for capability patterns.
 * Bounded by file count and byte budget so a large plugin cannot stall the audit.
 *
 * @returns {Array<{id: string, severity: string, title: string, detail: string, hits: Array<{file: string, line: number, snippet: string}>, files: number}>}
 */
export function scanCapabilities(root, { maxFiles = 60, maxBytes = 2_000_000, maxHitsPerRule = 3 } = {}) {
  const counts = new Map(CAPABILITY_RULES.map((r) => [r.id, { rule: r, hits: [], files: new Set() }]));
  let files = 0;
  let bytes = 0;

  const walk = (dir) => {
    if (files >= maxFiles || bytes >= maxBytes) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files >= maxFiles || bytes >= maxBytes) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile() || !CODE_EXT.has(path.extname(entry.name).toLowerCase())) continue;
      let text;
      try {
        const stat = fs.statSync(full);
        if (stat.size > maxBytes - bytes) continue;
        text = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      files++;
      bytes += text.length;
      const code = maskComments(text);
      const rel = path.relative(root, full).split(path.sep).join('/');
      for (const rule of CAPABILITY_RULES) {
        const slot = counts.get(rule.id);
        const re = new RegExp(rule.re.source, 'g');
        let m;
        while ((m = re.exec(code)) !== null) {
          slot.files.add(rel);
          if (slot.hits.length < maxHitsPerRule) {
            slot.hits.push({
              file: rel,
              line: lineOf(text, m.index),
              snippet: code.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\s+/g, ' ').trim().slice(0, 120),
            });
          }
          if (slot.hits.length >= maxHitsPerRule && slot.files.size > maxHitsPerRule) break;
        }
      }
    }
  };

  walk(root);

  const findings = [];
  for (const { rule, hits, files: fileSet } of counts.values()) {
    if (fileSet.size === 0) continue;
    findings.push({
      id: `capability:${rule.id}`,
      category: 'capability',
      severity: rule.severity,
      title: rule.title,
      detail: `${rule.detail} 命中 ${fileSet.size} 个文件。`,
      evidence: hits,
    });
  }
  return findings;
}

/** Read one dependency spec from the profile manifest. */
export function dependencySpec(home, profile, packageName) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(profileDir(home, profile), 'package.json'), 'utf8'));
    const deps = manifest.dependencies ?? {};
    const dev = manifest.devDependencies ?? {};
    return deps[packageName] ?? dev[packageName] ?? null;
  } catch {
    return null;
  }
}

/** Classify a dependency spec into a source finding, or null when it is a plain registry range. */
export function classifySpec(spec) {
  if (typeof spec !== 'string' || spec === '') return null;
  const s = spec.trim();
  if (/^(file|link|portal):/i.test(s)) {
    return { id: 'source:local', severity: 'medium', title: '本地路径依赖', detail: `依赖 spec 为 ${s}，来源不可追溯、不可复现。` };
  }
  if (/^(github|git\+|git:)/i.test(s)) {
    return { id: 'source:git', severity: 'low', title: 'Git 来源依赖', detail: `依赖 spec 为 ${s}，直接取自 Git 仓库而非 npm 注册表。` };
  }
  if (s === '*' || /^latest$/i.test(s)) {
    return { id: 'source:unpinned', severity: 'medium', title: '版本未固定', detail: `依赖 spec 为 ${s}，任何新发布都会在下一次安装时生效。` };
  }
  if (/^(workspace|npm:)/i.test(s)) return null;
  if (/^[~^]?\d/.test(s) === false && /^[<>]=?/.test(s)) {
    return { id: 'source:range', severity: 'low', title: '宽松版本范围', detail: `依赖 spec 为 ${s}。` };
  }
  return null;
}

/**
 * Look for the resolved integrity hash of a package inside pnpm-lock.yaml.
 * Targeted line scan: no YAML dependency, tolerant of lockfile format drift.
 *
 * @returns {'present'|'missing'|'unknown'}
 */
export function lockfileIntegrity(home, profile, packageName, version) {
  const lock = path.join(profileDir(home, profile), 'pnpm-lock.yaml');
  let text;
  try {
    text = fs.readFileSync(lock, 'utf8');
  } catch {
    return 'unknown';
  }
  const key = version ? `${packageName}@${version}` : packageName;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(key)) continue;
    for (let j = i; j < Math.min(lines.length, i + 8); j++) {
      if (/\bintegrity:\s*sha/i.test(lines[j])) return 'present';
      if (/^\s{2}\S/.test(lines[j]) && j > i) break;
    }
    return 'missing';
  }
  return 'unknown';
}

/**
 * Install-time script names.
 *
 * Severity is deliberately not flat: npm/pnpm runs preinstall/install/postinstall
 * for **registry** installs, while `prepare` runs only for git/local sources and
 * in-package installs. A GitHub-sourced plugin therefore executes `prepare` on
 * every install whereas a registry-sourced one does not.
 */
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];
const REGISTRY_INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'];

/** Is this dependency spec fetched from git/local rather than the npm registry? */
export function isRemoteOrLocalSource(spec) {
  return typeof spec === 'string' && /^(github|git\+|git:|file:|link:|portal:)/i.test(spec.trim());
}

/** Audit one plugin package. Pure metadata + file reads. */
export function auditPackage(home, profile, item, { runtime = null, scan = true } = {}) {
  const findings = [];
  const name = item.package;
  const spec = dependencySpec(home, profile, name);

  const sourceFinding = classifySpec(spec);
  if (sourceFinding) findings.push({ category: 'supply-chain', ...sourceFinding, detail: `${sourceFinding.detail}（spec: ${spec}）` });

  const pkgDir = path.join(profileDir(home, profile), 'node_modules', name);
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  } catch {
    /* installed manifest unreadable */
  }

  if (manifest) {
    const scripts = manifest.scripts ?? {};
    const present = INSTALL_SCRIPTS.filter((s) => typeof scripts[s] === 'string' && scripts[s].trim() !== '');
    const alwaysRun = present.filter((s) => REGISTRY_INSTALL_SCRIPTS.includes(s));
    const prepareOnly = present.filter((s) => s === 'prepare');
    const evidence = present.map((s) => ({ file: 'package.json', snippet: `${s}: ${String(scripts[s]).slice(0, 80)}` }));

    if (alwaysRun.length > 0) {
      findings.push({
        id: 'install-scripts',
        category: 'execution',
        severity: 'high',
        title: '安装期执行脚本',
        detail: `安装时会执行 ${alwaysRun.join(' / ')}（npm/pnpm 在注册表安装时即运行）。安装即执行任意代码。`,
        evidence,
      });
    } else if (prepareOnly.length > 0 && isRemoteOrLocalSource(spec)) {
      findings.push({
        id: 'install-scripts:prepare-from-source',
        category: 'execution',
        severity: 'high',
        title: '安装期执行脚本（git/本地源）',
        detail: `该包来自 ${spec}；pnpm 安装 git/本地源时会执行 prepare 脚本，等价于安装即执行任意代码。`,
        evidence,
      });
    } else if (prepareOnly.length > 0) {
      findings.push({
        id: 'install-scripts:prepare',
        category: 'execution',
        severity: 'low',
        title: '存在 prepare 脚本',
        detail: '注册表安装不会执行 prepare；仅在该包目录内安装或从 git/本地源安装时运行。',
        evidence,
      });
    }

    if (!manifest.license) findings.push({ id: 'meta:license', category: 'metadata', severity: 'low', title: '缺少 license', detail: '未声明许可证，再分发与合规性不明。' });
    if (!manifest.repository) findings.push({ id: 'meta:repository', category: 'metadata', severity: 'low', title: '缺少 repository', detail: '未声明源码仓库，无法核对代码与发布物是否一致。' });
    if (!manifest.version) findings.push({ id: 'meta:version', category: 'metadata', severity: 'info', title: '缺少 version', detail: '未声明版本号。' });
  }

  const integrity = lockfileIntegrity(home, profile, name, item.installed);
  if (integrity === 'missing') {
    findings.push({ id: 'lock:integrity', category: 'supply-chain', severity: 'low', title: 'lockfile 缺少完整性哈希', detail: 'pnpm-lock.yaml 中该包没有 integrity 记录，无法校验下载产物。' });
  }

  if (scan && fs.existsSync(pkgDir)) findings.push(...scanCapabilities(pkgDir).map((f) => ({ ...f, category: 'capability' })));

  if (runtime && runtime.fiberPhase === 'failed') {
    findings.push({ id: 'runtime:failed', category: 'runtime', severity: 'medium', title: '插件加载失败', detail: '官方插件清单报告该插件当前处于 failed 状态。' });
  }

  // `spec` is how it was installed (authoritative for install-time risk);
  // `github` is where the source lives. They are different questions and must
  // not be conflated: a registry-pinned plugin can still point at a GitHub repo.
  return { package: name, installed: item.installed, spec: spec ?? null, github: item.github ?? null, findings };
}

/** Aggregate findings into a score and grade. */
export function summarize(items) {
  const counts = { high: 0, medium: 0, low: 0, info: 0 };
  for (const item of items) for (const f of item.findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  const penalty = Object.entries(counts).reduce((acc, [sev, n]) => acc + (SEVERITY_WEIGHT[sev] ?? 0) * n, 0);
  const score = Math.max(0, 100 - penalty);
  return { counts, score, grade: gradeFor(score) };
}

/** Audit every plugin installed in the profile. */
export function auditAll(home, profile, { runtime = null, scan = true } = {}) {
  const discovered = discoverPackages(home, profile);
  const runtimeByName = new Map((runtime?.entries ?? []).map((e) => [e.moduleName, e]));
  const items = discovered.map((item) =>
    auditPackage(home, profile, item, { runtime: runtimeByName.get(item.package) ?? null, scan }),
  );
  items.sort((a, b) => {
    const wa = Math.max(0, ...a.findings.map((f) => SEVERITY_WEIGHT[f.severity] ?? 0));
    const wb = Math.max(0, ...b.findings.map((f) => SEVERITY_WEIGHT[f.severity] ?? 0));
    return wb - wa || a.package.localeCompare(b.package);
  });
  return { items, summary: summarize(items), home, profile };
}

// ---------------------------------------------------------------- update preview

/** Fetch one published version's manifest from the npm registry. */
export function fetchVersionManifest(packageName, version) {
  return new Promise((resolve) => {
    const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`;
    const req = https.get(url, { headers: { 'user-agent': 'dsh-security-manager' } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null);
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(30000, () => req.destroy());
  });
}

/** Compare the risk-relevant fields of two manifests. */
export function diffManifests(before, after) {
  const findings = [];
  const bs = before?.scripts ?? {};
  const as = after?.scripts ?? {};
  const changed = [];
  for (const key of new Set([...Object.keys(bs), ...Object.keys(as)])) {
    if ((bs[key] ?? '') === (as[key] ?? '')) continue;
    const isInstall = INSTALL_SCRIPTS.includes(key);
    if (!(key in bs) && isInstall) changed.push({ key, kind: 'added-install', severity: 'high' });
    else if (isInstall) changed.push({ key, kind: 'changed-install', severity: 'high' });
    else if (!(key in bs)) changed.push({ key, kind: 'added', severity: 'low' });
    else if (!(key in as)) changed.push({ key, kind: 'removed', severity: 'info' });
    else changed.push({ key, kind: 'changed', severity: 'low' });
  }
  for (const c of changed) {
    findings.push({
      id: `script:${c.kind}`,
      category: 'execution',
      severity: c.severity,
      title: `脚本 ${c.kind === 'added-install' ? '新增安装期执行' : c.kind === 'changed-install' ? '安装期脚本变更' : c.kind === 'added' ? '新增' : c.kind === 'removed' ? '移除' : '变更'}：${c.key}`,
      detail: `before: ${JSON.stringify(bs[c.key] ?? null)} → after: ${JSON.stringify(as[c.key] ?? null)}`,
    });
  }
  const bd = Object.keys(before?.dependencies ?? {});
  const ad = Object.keys(after?.dependencies ?? {});
  const added = ad.filter((d) => !bd.includes(d));
  const removed = bd.filter((d) => !ad.includes(d));
  if (added.length || removed.length) {
    findings.push({
      id: 'deps:changed',
      category: 'dependencies',
      severity: 'low',
      title: '依赖集合变化',
      detail: `新增 ${added.length} 个${added.length ? `（${added.slice(0, 5).join(', ')}${added.length > 5 ? '…' : ''}）` : ''}，移除 ${removed.length} 个${removed.length ? `（${removed.slice(0, 5).join(', ')}${removed.length > 5 ? '…' : ''}）` : ''}。`,
    });
  }
  if ((before?.license ?? null) !== (after?.license ?? null)) {
    findings.push({ id: 'meta:license-changed', category: 'metadata', severity: 'low', title: '许可证变化', detail: `${JSON.stringify(before?.license ?? null)} → ${JSON.stringify(after?.license ?? null)}` });
  }
  if ((before?.repository?.url ?? before?.repository ?? null) !== (after?.repository?.url ?? after?.repository ?? null)) {
    findings.push({ id: 'meta:repo-changed', category: 'metadata', severity: 'medium', title: '源码仓库变化', detail: '发布物的 repository 字段发生变化，可能是仓库迁移或账号易手。' });
  }
  return findings;
}

/**
 * Preview what installing `version` would change, risk-wise.
 * Network only; never installs anything.
 */
export async function previewUpdate(home, profile, packageName, version, { fetchManifest = fetchVersionManifest } = {}) {
  const installedVersion = discoverPackages(home, profile).find((p) => p.package === packageName)?.installed ?? null;
  const target = version ?? null;
  if (!target) return { ok: false, error: 'version required' };
  const after = await fetchManifest(packageName, target);
  if (!after) return { ok: false, error: `cannot fetch ${packageName}@${target} from the npm registry` };
  let before = null;
  try {
    before = JSON.parse(fs.readFileSync(path.join(profileDir(home, profile), 'node_modules', packageName, 'package.json'), 'utf8'));
  } catch {
    /* not installed locally */
  }
  const findings = before ? diffManifests(before, after) : [];
  return {
    ok: true,
    package: packageName,
    from: installedVersion,
    to: target,
    findings,
    summary: { counts: findings.reduce((acc, f) => ((acc[f.severity] = (acc[f.severity] ?? 0) + 1), acc), { high: 0, medium: 0, low: 0, info: 0 }) },
  };
}

// ---- standalone self-test ----
const __selfTest = process.argv[1] && process.argv[1].endsWith('audit.js') && process.argv.includes('--self-test');
if (__selfTest) {
  const home = resolveHome(process.argv.includes('--home') ? process.argv[process.argv.indexOf('--home') + 1] : '');
  const profile = process.argv.includes('--profile') ? process.argv[process.argv.indexOf('--profile') + 1] : 'web';
  const result = auditAll(home, profile);
  process.stdout.write(JSON.stringify({ ok: true, home, profile, summary: result.summary, items: result.items }, null, 2) + '\n');
}
