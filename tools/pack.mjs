// 打商店包：把运行期文件压成 ZIP，供 Chrome Web Store 与 Edge Add-ons 上传。
// 用法：node tools/pack.mjs
// 产物：dist/coordkey-<manifest.version>.zip
//
// 手写 ZIP（store 法，不压缩）而不是调系统 zip 命令：CI 与 Windows 上都能跑，也不引依赖。
// 不压缩的代价可以忽略——PNG 本来就是压缩过的，JS 全文加起来才几十 KB。
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// 只打运行期需要的东西。tools/ test/ docs/ README 是给人看的，进包只会增加体积与审核面。
const PACK_DIRS = ['src', 'assets'];

// 固定时间戳（2020-01-01 00:00:00）而不是当前时间：同一个提交无论何时何地打包，
// ZIP 的字节都完全一致，事后能核对「上传到商店的包」与「仓库里那个 tag」是不是同一份。
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;
// 文件名按 UTF-8 编码，置位 general purpose flag 的第 11 位
const FLAG_UTF8 = 0x0800;
const VERSION_NEEDED = 20;
const METHOD_STORE = 0;

function walk(dir, base, out = []) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    // 跳过点文件：macOS 的 .DS_Store 混进 src/ 会被一起打包，商店审核会看到无关文件
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

// manifest 里点名的文件必须都在包里。漏一个新加的内容脚本，扩展装上去就是静默失效，
// 这种错在商店审核阶段才暴露，代价太高，所以打包时就拦掉。
function referencedByManifest(manifest) {
  const paths = [];
  if (manifest.background?.service_worker) paths.push(manifest.background.service_worker);
  for (const cs of manifest.content_scripts ?? []) {
    paths.push(...(cs.js ?? []), ...(cs.css ?? []));
  }
  for (const icons of [manifest.icons, manifest.action?.default_icon]) {
    if (icons) paths.push(...Object.values(icons));
  }
  return paths;
}

function packZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { path, data } of entries) {
    const name = Buffer.from(path, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(METHOD_STORE, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(VERSION_NEEDED, 4);
    central.writeUInt16LE(VERSION_NEEDED, 6);
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(METHOD_STORE, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, cd, eocd]);
}

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

// manifest.json 必须落在 ZIP 根目录，不能包一层文件夹——商店解压后找不到 manifest 会直接驳回
const paths = ['manifest.json', ...PACK_DIRS.flatMap((dir) => walk(join(root, dir), root))];

const packed = new Set(paths);
const missing = referencedByManifest(manifest).filter((p) => !packed.has(p));
if (missing.length) {
  console.error(`PACK: FAILED manifest 引用了不在包里的文件：\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

const entries = paths.map((path) => ({ path, data: readFileSync(join(root, path)) }));
const zip = packZip(entries);

const outDir = join(root, 'dist');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `coordkey-${manifest.version}.zip`);
writeFileSync(outFile, zip);

const raw = entries.reduce((sum, e) => sum + e.data.length, 0);
console.log(`文件数   : ${entries.length}`);
console.log(`原始字节 : ${raw}`);
console.log(`ZIP 字节 : ${zip.length}`);
console.log(`产物     : ${relative(root, outFile).split(sep).join('/')}`);
console.log('PACK: OK');
