/**
 * Unit tests for the audit engine — run with `node --test`.
 *
 * These lock in the behaviour that makes the audit trustworthy:
 * comments are never reported as capabilities, capability inventory does not
 * affect the score, and install-script severity depends on how the package
 * was actually installed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  auditAll,
  classifySpec,
  diffManifests,
  gradeFor,
  isRemoteOrLocalSource,
  maskComments,
  scanCapabilities,
  summarize,
  SEVERITY_WEIGHT,
} from '../lib/audit.js';

/** Build a throwaway DSH home with one profile and a set of fake plugins. */
function makeFixture({ dependencies = {}, packages = {} } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-audit-'));
  const profileDir = path.join(home, 'profiles', 'web');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({ name: 'p', private: true, dependencies }, null, 2));
  for (const [name, spec] of Object.entries(packages)) {
    const dir = path.join(profileDir, 'node_modules', name);
    fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...spec.manifest }, null, 2));
    for (const [file, content] of Object.entries(spec.files ?? {})) {
      const target = path.join(dir, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  }
  return { home, profileDir };
}

// ---------------------------------------------------------------- comments

test('maskComments blanks comments but keeps byte length and string literals', () => {
  const src = [
    'const a = 1; // eval("boom")',
    '/* child_process spawn( */',
    'const p = "settings.yaml";',
    'const q = "has // slashes";',
  ].join('\n');
  const masked = maskComments(src);
  assert.equal(masked.length, src.length, 'length must be preserved for index/line fidelity');
  assert.equal(masked.split('\n').length, src.split('\n').length, 'line count must be preserved');
  assert.ok(!masked.includes('eval('), 'line comment content must be blanked');
  assert.ok(!masked.includes('child_process'), 'block comment content must be blanked');
  assert.ok(masked.includes('settings.yaml'), 'string literals are kept (real signal)');
  assert.ok(masked.includes('has // slashes'), 'a comment marker inside a string must not corrupt parsing');
});

test('capability scan ignores comments but reports real code', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-scan-'));
  fs.writeFileSync(path.join(dir, 'docs.js'), '// we never call child_process\n/* spawn( */\n');
  fs.writeFileSync(path.join(dir, 'real.js'), 'import { spawn } from "node:child_process";\nspawn("pwsh", []);\n');
  const findings = scanCapabilities(dir);
  const child = findings.find((f) => f.id === 'capability:child-process');
  assert.ok(child, 'real child_process usage must be reported');
  assert.ok(child.evidence.some((h) => h.file === 'real.js'), 'evidence must point at the real file');
  assert.ok(!child.evidence.some((h) => h.file === 'docs.js'), 'comment-only mentions must not appear');
  assert.ok(child.evidence.every((h) => Number.isInteger(h.line) && h.line > 0), 'evidence carries a line number');
});

test('capability inventory is informational and does not move the score', () => {
  const items = [
    {
      package: 'p',
      findings: [
        { id: 'capability:child-process', severity: 'info', title: '', detail: '' },
        { id: 'capability:network-egress', severity: 'info', title: '', detail: '' },
      ],
    },
  ];
  const s = summarize(items);
  assert.equal(s.score, 100);
  assert.equal(s.grade, 'A');
  assert.equal(SEVERITY_WEIGHT.info, 0);
});

test('gradeFor maps scores to letters', () => {
  assert.equal(gradeFor(100), 'A');
  assert.equal(gradeFor(90), 'A');
  assert.equal(gradeFor(89), 'B');
  assert.equal(gradeFor(60), 'C');
  assert.equal(gradeFor(10), 'D');
});

// ---------------------------------------------------------------- specs

test('classifySpec distinguishes local / git / unpinned / pinned', () => {
  assert.equal(classifySpec('1.0.0'), null, 'an exact pin is clean');
  assert.equal(classifySpec('^1.2.3'), null);
  assert.equal(classifySpec('file:D:/tmp/pkg.tgz').id, 'source:local');
  assert.equal(classifySpec('github:owner/repo#v1').id, 'source:git');
  assert.equal(classifySpec('*').id, 'source:unpinned');
  assert.equal(classifySpec('latest').id, 'source:unpinned');
  assert.equal(classifySpec(null), null);
});

test('isRemoteOrLocalSource recognises git and local specs only', () => {
  assert.equal(isRemoteOrLocalSource('github:o/r'), true);
  assert.equal(isRemoteOrLocalSource('file:/x.tgz'), true);
  assert.equal(isRemoteOrLocalSource('1.0.0'), false);
  assert.equal(isRemoteOrLocalSource(undefined), false);
});

// ---------------------------------------------------------------- scripts

test('registry-pinned prepare is low, git-sourced prepare is high', () => {
  const registry = makeFixture({
    dependencies: { 'p-reg': '1.0.0' },
    packages: { 'p-reg': { manifest: { scripts: { prepare: 'pnpm build' } } } },
  });
  const git = makeFixture({
    dependencies: { 'p-git': 'github:owner/repo#v1' },
    packages: { 'p-git': { manifest: { scripts: { prepare: 'pnpm build' } } } },
  });
  const reg = auditAll(registry.home, 'web').items[0];
  const gits = auditAll(git.home, 'web').items[0];
  const regPrepare = reg.findings.find((f) => f.id.startsWith('install-scripts'));
  const gitPrepare = gits.findings.find((f) => f.id.startsWith('install-scripts'));
  assert.equal(regPrepare.severity, 'low', 'prepare does not run for registry installs');
  assert.equal(gitPrepare.severity, 'high', 'prepare runs when installing from git');
  assert.match(gitPrepare.title, /git/);
});

test('postinstall is always high and carries evidence', () => {
  const f = makeFixture({
    dependencies: { 'p-post': '1.0.0' },
    packages: { 'p-post': { manifest: { scripts: { postinstall: 'node evil.js' } } } },
  });
  const item = auditAll(f.home, 'web').items[0];
  const finding = item.findings.find((x) => x.id === 'install-scripts');
  assert.equal(finding.severity, 'high');
  assert.ok(finding.evidence[0].snippet.includes('postinstall'));
});

test('auditAll reports metadata gaps and keeps a real installed version', () => {
  const f = makeFixture({
    dependencies: { 'p-bare': '1.0.0' },
    packages: { 'p-bare': { manifest: { version: '1.0.0' } } },
  });
  const item = auditAll(f.home, 'web').items[0];
  assert.equal(item.installed, '1.0.0');
  assert.equal(item.spec, '1.0.0');
  const ids = item.findings.map((x) => x.id);
  assert.ok(ids.includes('meta:license'));
  assert.ok(ids.includes('meta:repository'));
});

// ---------------------------------------------------------------- preview

test('diffManifests flags a newly added install script as high', () => {
  const findings = diffManifests(
    { scripts: { build: 'tsc' }, dependencies: { a: '1' }, license: 'MIT' },
    { scripts: { build: 'tsc', postinstall: 'node x.js' }, dependencies: { a: '1', b: '2' }, license: 'MIT' },
  );
  const install = findings.find((f) => f.id === 'script:added-install');
  assert.ok(install, 'a new postinstall must be surfaced');
  assert.equal(install.severity, 'high');
  assert.ok(findings.some((f) => f.id === 'deps:changed'));
  assert.equal(findings.find((f) => f.id === 'meta:license-changed'), undefined);
});

test('diffManifests flags a repository change as medium', () => {
  const findings = diffManifests(
    { repository: { url: 'git+https://github.com/a/b.git' } },
    { repository: { url: 'git+https://github.com/c/d.git' } },
  );
  const repo = findings.find((f) => f.id === 'meta:repo-changed');
  assert.ok(repo);
  assert.equal(repo.severity, 'medium');
});
