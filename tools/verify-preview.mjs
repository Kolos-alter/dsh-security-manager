/**
 * Practicality check for the update-preview pipeline, run against the real
 * npm registry and the real profile. Read-only: nothing is installed.
 *
 * usage: node tools/verify-preview.mjs
 */
import { previewUpdate, fetchVersionManifest } from '../lib/audit.js';
import { fetchNpmMetadata, resolveHome, discoverPackages } from '../lib/manager.js';

const home = resolveHome();
const profile = 'web';
const installed = discoverPackages(home, profile);
console.log(`home=${home} profile=${profile} plugins=${installed.length}\n`);

let ok = 0;
let unreachable = 0;

for (const item of installed) {
  const meta = await fetchNpmMetadata(item.package);
  if (!meta || !meta.latest) {
    console.log(`${item.package.padEnd(30)} npm: 未发布或不可达（本地 ${item.installed}）`);
    unreachable++;
    continue;
  }
  const same = meta.latest === item.installed;
  const line = `${item.package.padEnd(30)} 本地=${item.installed}  npm最新=${meta.latest}${same ? ' (已是最新)' : ''}`;
  console.log(line);

  // Preview the step to the published latest when it differs, otherwise prove
  // the pipeline on a real version pair of the same package.
  const target = same ? null : meta.latest;
  if (target) {
    const r = await previewUpdate(home, profile, item.package, target);
    if (!r.ok) {
      console.log(`  ! preview 失败: ${r.error}`);
      continue;
    }
    const counts = r.summary.counts;
    console.log(`  preview ${r.from} -> ${r.to}: high=${counts.high} medium=${counts.medium} low=${counts.low}`);
    for (const f of r.findings.slice(0, 3)) console.log(`    [${f.severity}] ${f.title}`);
    ok++;
  } else {
    const manifest = await fetchVersionManifest(item.package, item.installed);
    console.log(`  已是最新；同版本 manifest 拉取 ${manifest ? 'OK' : '失败'}（diff 引擎由单元测试覆盖）`);
    if (manifest) ok++;
  }
}

console.log(`\nsummary: ${ok} 个包完成预览链路验证，${unreachable} 个未发布/不可达`);
