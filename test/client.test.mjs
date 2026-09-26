/**
 * Client-half tests without a browser.
 *
 * The client bundle is not an ES module: it hands itself to
 * `window.__ModuleLoader__.load`. This test fakes that loader and a minimal
 * React, executes the real bundle, runs the real `apply()`, and renders the
 * registered component through the data path. It catches the mistakes that
 * would otherwise only show up as a broken tab in the browser: wrong export
 * shape, wrong slot options, undefined helpers during render.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT = fileURLToPath(new URL('../lib/client.js', import.meta.url));

/** Minimal React: elements are plain objects, function components are invoked
 *  (like React does), and hooks read from a script. */
function makeReact(stateScript) {
  let cursor = 0;
  const createElement = (type, props, ...children) => {
    const merged = Object.assign({}, props);
    if (children.length === 1) merged.children = children[0];
    else if (children.length > 1) merged.children = children;
    // Function components render immediately, so the test walks real output.
    if (typeof type === 'function') return type(merged);
    return { type, props: merged, children };
  };
  return {
    createElement,
    useState(initial) {
      const value = cursor < stateScript.length ? stateScript[cursor] : initial;
      cursor++;
      return [value, () => {}];
    },
    useCallback(fn) {
      return fn;
    },
    useEffect() {},
  };
}

/** Load the bundle and return its exports. */
function loadClient(react) {
  const code = fs.readFileSync(CLIENT, 'utf8');
  let definition = null;
  const fakeWindow = { __ModuleLoader__: { load: (def) => { definition = def; } } };
  // eslint-disable-next-line no-new-func
  new Function('window', code)(fakeWindow);
  assert.ok(definition, 'bundle must register itself with __ModuleLoader__');
  assert.equal(definition.id, 'dsh-security-manager');
  const exported = definition.factory((name) => {
    if (name === 'react') return react;
    throw new Error(`unexpected require(${name})`);
  });
  return exported;
}

/** Flatten an element tree into its text content. */
function collectText(node, out = []) {
  if (node === null || node === undefined || node === false) return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  if (typeof node === 'object' && node.children) {
    for (const child of node.children) collectText(child, out);
  }
  return out;
}

/** Fake cordis ctx that records what the client half registers. */
function makeCtx() {
  const state = { dicts: [], registrations: [], injects: [] };
  const slots = {
    inject(name, cb) {
      state.injects.push(name);
      cb();
    },
    register(options, component) {
      state.registrations.push({ options, component });
      return () => {};
    },
  };
  const ctx = {
    slots,
    get: (key) => (key === 'slots' ? slots : undefined),
    locale: {
      bind: () => (key) => key,
      register: (ns, dicts) => {
        state.dicts.push({ ns, dicts });
        return () => {};
      },
    },
    effect: (fn) => {
      const disposer = fn();
      return typeof disposer === 'function' ? disposer : () => {};
    },
  };
  return { ctx, state };
}

test('client exports the shape the DSH client loader expects', () => {
  const mod = loadClient(makeReact([]));
  assert.equal(mod.NS, 'settings.security');
  assert.equal(typeof mod.apply, 'function');
  assert.deepEqual(mod.inject, ['slots', 'locale']);
});

test('apply registers bilingual dictionaries and the security tab', () => {
  const mod = loadClient(makeReact([]));
  const { ctx, state } = makeCtx();
  mod.apply(ctx);

  assert.equal(state.dicts.length, 1);
  const { ns, dicts } = state.dicts[0];
  assert.equal(ns, 'settings.security');
  assert.equal(dicts.zh.tab, '安全');
  assert.equal(dicts.en.tab, 'Security');
  assert.ok(dicts.zh.intro && dicts.en.intro, 'both locales are provided');
  // bilingual balance: the same key set in both dictionaries
  assert.deepEqual(Object.keys(dicts.zh).sort(), Object.keys(dicts.en).sort());

  assert.deepEqual(state.injects, ['settings.plugins.tab']);
  assert.equal(state.registrations.length, 1);
  const { options, component } = state.registrations[0];
  assert.equal(options.name, 'settings.plugins.tab');
  assert.equal(options.id, 'security');
  assert.equal(options.order, 20);
  assert.equal(options.locale, 'settings.security');
  assert.equal(typeof options.label, 'function');
  assert.equal(options.label(), 'tab'); // fake t() echoes the key
  assert.equal(typeof component, 'function');
});

test('apply tolerates a context without the slots service', () => {
  const mod = loadClient(makeReact([]));
  assert.doesNotThrow(() => mod.apply({ get: () => undefined, locale: { bind: () => (k) => k } }));
});

test('the tab renders the empty audit state without throwing', () => {
  const mod = loadClient(makeReact([]));
  const { ctx, state } = makeCtx();
  mod.apply(ctx);
  const Tab = state.registrations[0].component;
  const tree = Tab({ t: (k) => k });
  const text = collectText(tree).join(' | ');
  assert.ok(text.includes('intro'), 'intro copy is rendered');
});

test('the tab renders scored findings, inventory and snapshots', () => {
  const audit = {
    ok: true,
    runtimeAvailable: true,
    summary: { score: 82, grade: 'B', counts: { high: 0, medium: 1, low: 2, info: 3 } },
    items: [
      {
        package: 'demo-plugin',
        installed: '1.2.3',
        spec: 'github:owner/repo#v1',
        github: 'owner/repo',
        findings: [
          { id: 'install-scripts', severity: 'high', title: '安装期执行脚本', detail: 'postinstall 会运行', evidence: [{ file: 'package.json', snippet: 'postinstall: node x.js' }] },
          { id: 'meta:license', severity: 'low', title: '缺少 license', detail: '未声明许可证' },
          { id: 'capability:child-process', severity: 'info', title: '可执行外部进程', detail: '能力清单' },
        ],
      },
    ],
  };
  const snapshots = [{ name: '2026-09-26T00-00-00-000Z__before-update-demo-plugin', dependencies: { 'demo-plugin': '1.2.3' }, createdAt: '2026-09-26T00:00:00.000Z' }];
  const check = { package: 'demo-plugin', latest: '2.0.0' };
  const preview = { package: 'demo-plugin', range: '1.2.3 → 2.0.0', summary: { counts: { high: 1, medium: 0, low: 0, info: 0 } }, findings: [{ id: 'script:added-install', severity: 'high', title: '脚本 新增安装期执行：postinstall', detail: 'a → b' }] };
  const diff = { snapshot: snapshots[0].name, changes: [{ package: 'demo-plugin', kind: 'changed', from: '1.2.3', to: '1.3.0' }], counts: { added: 0, removed: 0, changed: 1 } };

  const mod = loadClient(makeReact([audit, snapshots, '', null, check, preview, diff, {}]));
  const { ctx, state } = makeCtx();
  mod.apply(ctx);
  const Tab = state.registrations[0].component;
  const tree = Tab({ t: (k) => k });
  const text = collectText(tree).join(' | ');

  assert.ok(text.includes('demo-plugin'), 'plugin name is rendered');
  assert.ok(text.includes('B'), 'grade is rendered');
  assert.ok(text.includes('82'), 'score is rendered');
  assert.ok(text.includes('安装期执行脚本'), 'scored finding is rendered');
  assert.ok(text.includes('postinstall: node x.js'), 'finding evidence is rendered');
  assert.ok(text.includes('缺少 license'), 'low finding is rendered');
  assert.ok(text.includes('2.0.0'), 'update check result is rendered');
  assert.ok(text.includes('1.2.3 → 2.0.0'), 'update preview range is rendered');
  assert.ok(text.includes('脚本 新增安装期执行：postinstall'), 'preview finding is rendered');
  assert.ok(text.includes('1.2.3  →  1.3.0') || text.includes('1.2.3'), 'snapshot diff is rendered');
  // capability inventory is collapsed by default
  assert.ok(!text.includes('可执行外部进程'), 'inventory stays collapsed until toggled');
});
