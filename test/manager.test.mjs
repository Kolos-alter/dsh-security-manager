/**
 * Unit tests for the snapshot diff and per-package rollback helpers.
 * Run with `node --test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  diffSnapshot,
  listSnapshots,
  makeSnapshot,
  pnpmAddTarget,
  rollbackPackage,
  snapshotDependencies,
} from '../lib/manager.js';

/** Throwaway home with a profile manifest. */
function fixture(dependencies) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mgr-'));
  const profileDir = path.join(home, 'profiles', 'web');
  fs.mkdirSync(profileDir, { recursive: true });
  const write = (deps) => fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({ name: 'p', private: true, dependencies: deps }, null, 2));
  write(dependencies);
  return { home, profileDir, write };
}

test('pnpmAddTarget qualifies bare versions and passes protocols through', () => {
  assert.equal(pnpmAddTarget('pkg', '1.2.3'), 'pkg@1.2.3');
  assert.equal(pnpmAddTarget('pkg', '^1.2.3'), 'pkg@^1.2.3');
  assert.equal(pnpmAddTarget('pkg', 'file:D:/x/pkg.tgz'), 'file:D:/x/pkg.tgz');
  assert.equal(pnpmAddTarget('pkg', 'github:owner/repo#v1'), 'github:owner/repo#v1');
  assert.equal(pnpmAddTarget('@scope/pkg', '2.0.0'), '@scope/pkg@2.0.0');
  assert.throws(() => pnpmAddTarget('pkg', ''), /empty spec/);
  assert.throws(() => pnpmAddTarget('pkg', '   '), /empty spec/);
});

test('makeSnapshot records dependencies and is listable', () => {
  const { home } = fixture({ a: '1.0.0', b: '2.0.0' });
  const snap = makeSnapshot(home, 'web', 'unit-test');
  assert.ok(fs.existsSync(path.join(snap.dir, 'package.json')));
  assert.ok(snap.copied.includes('package.json'));
  const deps = snapshotDependencies(home, 'web', path.basename(snap.dir));
  assert.deepEqual(deps, { a: '1.0.0', b: '2.0.0' });
  const list = listSnapshots(home, 'web');
  assert.equal(list.length, 1);
  assert.equal(list[0].name, path.basename(snap.dir));
});

test('diffSnapshot reports added / removed / changed since the snapshot', () => {
  const { home, write } = fixture({ a: '1.0.0', b: '2.0.0' });
  const snap = makeSnapshot(home, 'web', 'before-change');
  const name = path.basename(snap.dir);

  write({ a: '1.1.0', c: '3.0.0' }); // a upgraded, b removed, c added

  const diff = diffSnapshot(home, 'web', name);
  assert.equal(diff.snapshot, name);
  assert.ok(diff.createdAt, 'createdAt is read from the snapshot manifest');
  const byName = Object.fromEntries(diff.changes.map((c) => [c.package, c]));
  assert.deepEqual(byName.a, { package: 'a', kind: 'changed', from: '1.0.0', to: '1.1.0' });
  assert.deepEqual(byName.b, { package: 'b', kind: 'removed', from: '2.0.0', to: null });
  assert.deepEqual(byName.c, { package: 'c', kind: 'added', from: null, to: '3.0.0' });
  assert.deepEqual(diff.counts, { added: 1, removed: 1, changed: 1 });
});

test('diffSnapshot reports no changes when nothing moved', () => {
  const { home } = fixture({ a: '1.0.0' });
  const snap = makeSnapshot(home, 'web', 'noop');
  const diff = diffSnapshot(home, 'web', path.basename(snap.dir));
  assert.deepEqual(diff.changes, []);
  assert.deepEqual(diff.counts, { added: 0, removed: 0, changed: 0 });
});

test('diffSnapshot rejects unknown and malformed snapshot names', () => {
  const { home } = fixture({ a: '1.0.0' });
  assert.throws(() => diffSnapshot(home, 'web', 'nope'), /snapshot not found/);
  assert.throws(() => diffSnapshot(home, 'web', '../escape'), /invalid snapshot name/);
});

test('rollbackPackage refuses unknown packages and unsafe names before touching pnpm', async () => {
  const { home } = fixture({ a: '1.0.0' });
  const snap = makeSnapshot(home, 'web', 'guard');
  const name = path.basename(snap.dir);
  await assert.rejects(
    () => rollbackPackage(home, 'web', 'pnpm', 'missing-pkg', name),
    /has no record for missing-pkg/,
  );
  await assert.rejects(
    () => rollbackPackage(home, 'web', 'pnpm', '../../evil', name),
    /invalid package name/,
  );
});
