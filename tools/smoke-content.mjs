// 内容脚本顶层执行冒烟测试：在 Node 里用最小 DOM/chrome 桩按 manifest 顺序执行全部
// 内容脚本，捕捉引用错误与顶层逻辑异常。浏览器行为仍需人工验证。
// 用法：node tools/smoke-content.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const FILES = [
  'src/shared/protocol.js',
  'src/content/00-namespace.js',
  'src/content/core/hotkeys.js',
  'src/content/core/store.js',
  'src/content/core/clicker.js',
  'src/content/core/transfer.js',
  'src/content/ui/styles.js',
  'src/content/ui/hint.js',
  'src/content/ui/markers.js',
  'src/content/ui/recorder.js',
  'src/content/ui/panel.js',
  'src/content/main.js',
];

// 桩元素的 querySelector 不会解析 innerHTML，命中不到真实子树，只能返回替身。
// 替身必须按选择器缓存：hint.js 每次 container() 都要拿回同一个盒子，
// 否则预览层会被反复新建，「已记录 N 个点」这类断言无从下手。
function cachedQuery(host, sel) {
  if (!host.__queried) host.__queried = new Map();
  if (!host.__queried.has(sel)) host.__queried.set(sel, mkEl('div'));
  return host.__queried.get(sel);
}

// 真实 DOM 里给 textContent 赋值会替换掉全部子节点，桩也要照做，
// 否则 markers/drafts 每次重画都会把新元素追加到旧元素后面
function withTextContent(el) {
  let text = '';
  Object.defineProperty(el, 'textContent', {
    get() {
      return text;
    },
    set(value) {
      text = String(value);
      el.children.length = 0;
    },
  });
  return el;
}

function mkRoot() {
  return {
    children: [],
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    insertBefore(c) {
      this.children.unshift(c);
      return c;
    },
    querySelector(sel) {
      return cachedQuery(this, sel);
    },
    querySelectorAll() {
      return [];
    },
  };
}

function mkEl(tag) {
  return withTextContent({
    tagName: String(tag || 'div').toUpperCase(),
    style: { cssText: '' },
    dataset: {},
    children: [],
    hidden: false,
    value: '',
    checked: false,
    type: '',
    className: '',
    id: '',
    innerHTML: '',
    files: null,
    isConnected: true,
    setAttribute() {},
    getAttribute() {
      return null;
    },
    dispatchEvent() {
      return true;
    },
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    insertBefore(c) {
      this.children.unshift(c);
      return c;
    },
    append(...cs) {
      this.children.push(...cs);
    },
    removeChild(c) {
      this.children = this.children.filter((x) => x !== c);
    },
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    attachShadow() {
      return mkRoot();
    },
    querySelector(sel) {
      return cachedQuery(this, sel);
    },
    querySelectorAll() {
      return [];
    },
    closest() {
      return null;
    },
    contains() {
      return false;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720 };
    },
    click() {},
  });
}

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.defaultPrevented = false;
    this.propagationStopped = false;
    Object.assign(this, init);
  }

  preventDefault() {
    this.defaultPrevented = true;
  }

  stopPropagation() {
    this.propagationStopped = true;
  }
}

// window 上的监听器要真正登记，否则没法把事件喂给 recorder 的捕获处理器
const windowListeners = new Map();

globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.top = globalThis;
globalThis.addEventListener = (type, fn) => {
  if (!windowListeners.has(type)) windowListeners.set(type, new Set());
  windowListeners.get(type).add(fn);
};
globalThis.removeEventListener = (type, fn) => {
  const set = windowListeners.get(type);
  if (set) set.delete(fn);
};
globalThis.__fireWindow = (event) => {
  for (const fn of windowListeners.get(event.type) || []) fn(event);
  return event;
};
globalThis.PointerEvent = FakeEvent;
globalThis.MouseEvent = FakeEvent;
const fakeCanvas = mkEl('canvas');
globalThis.location = { origin: 'https://example.test', href: 'https://example.test/' };
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.devicePixelRatio = 1;
globalThis.document = {
  documentElement: mkEl('html'),
  body: mkEl('body'),
  visibilityState: 'visible',
  createElement: mkEl,
  addEventListener() {},
  removeEventListener() {},
  querySelectorAll(selector) {
    return selector === 'canvas' ? [fakeCanvas] : [];
  },
  elementFromPoint() {
    return fakeCanvas;
  },
};
globalThis.chrome = {
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
    },
    onChanged: { addListener() {} },
  },
  runtime: {
    onMessage: { addListener() {} },
    sendMessage: async () => null,
    getURL: (p) => p,
  },
};

let failed = false;
process.on('unhandledRejection', (err) => {
  failed = true;
  console.log('UNHANDLED REJECTION:', err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n') : err);
});

for (const file of FILES) {
  const code = readFileSync(join(root, file), 'utf8');
  try {
    vm.runInThisContext(code, { filename: file });
    console.log('OK  ', file);
  } catch (err) {
    failed = true;
    console.log('FAIL', file, '->', err.message);
  }
}

const KC = globalThis.KEYCLICK;
console.log('--- namespace ---');
console.log('modules:', KC ? Object.keys(KC).sort().join(', ') : 'MISSING');

// 组合键逻辑的纯函数自检
if (KC && KC.hotkeys) {
  const { comboId, comboLabel, comboSymbols, stepLabel, validate } = KC.hotkeys;
  const combo = { ctrl: true, shift: true, alt: false, meta: false, code: 'Digit1', key: '!' };
  console.log('comboId  :', comboId(combo));
  console.log('label    :', comboLabel(combo));
  console.log('symbols  :', comboSymbols(combo), '/', comboSymbols({ code: 'KeyH', key: 'h' }));
  console.log(
    'stepLabel:',
    stepLabel({ shift: true, code: 'KeyH', key: 'H' }, { index: 1, total: 3 }),
    '/',
    stepLabel({ code: 'KeyH', key: 'h' }, { index: 0, total: 1 }),
    '(expect 2/3 Shift + H / H)',
  );
  console.log('validate :', JSON.stringify(validate(combo)));
  console.log(
    'reserved :',
    JSON.stringify(validate({ ctrl: true, code: 'Digit1', key: '1' }).ok),
    '(expect false)',
  );
  console.log(
    'bare key :',
    JSON.stringify(validate({ code: 'KeyA', key: 'a' }).ok),
    '(expect true)',
  );
  console.log(
    'escape   :',
    JSON.stringify(validate({ code: 'Escape', key: 'Escape' }).ok),
    '(expect false)',
  );
}

const step = (nx, ny) => ({ nx, ny, x: Math.round(nx * 1280), y: Math.round(ny * 720), canvas: null });

// 存储层与方案模型的自检
if (KC && KC.store) {
  const origin = KC.origin;
  console.log('--- store ---');
  const normalized = KC.store.normalize({
    version: 2,
    settings: { enabled: true, preferDebugger: true, holdMs: 80 },
    sites: {
      'https://old.test': {
        enabled: true,
        schemes: {
          默认: {
            rules: [
              { id: 'a', shortcut: { code: 'KeyA' }, steps: [step(0.5, 0.5)] },
              { id: 'b', shortcut: { code: 'KeyB' }, nx: 0.5, ny: 0.5, x: 1, y: 2 },
              { id: 'c', shortcut: { code: 'KeyC' }, steps: [] },
            ],
          },
        },
      },
    },
  });
  const legacySite = normalized.sites['https://old.test'];
  const kept = legacySite.schemes['默认'].rules;
  console.log(
    '形状约束 :',
    'version', normalized.version, `(expect ${KC.VERSION})`,
    '| preferDebugger 残留', 'preferDebugger' in normalized.settings, '(expect false)',
    '| holdMs', normalized.settings.holdMs, '(expect 80)',
    '| recordPassthrough 补默认', normalized.settings.recordPassthrough, '(expect true)',
    '| 无 steps 的规则被丢弃', kept.length, '(expect 1)',
    '| 补默认间隔', kept[0] && kept[0].intervalMs, `(expect ${KC.DEFAULT_STEP_INTERVAL_MS})`,
  );

  await KC.store.load();
  await KC.store.upsertRule(origin, {
    id: 'r1',
    name: '测试',
    shortcut: { code: 'KeyH', key: 'h' },
    steps: [step(0.5, 0.5)],
    intervalMs: KC.DEFAULT_STEP_INTERVAL_MS,
  });
  console.log('写入规则 :', KC.store.rulesFor(origin).length, '(expect 1)');

  const patched = await KC.store.patchRule(origin, 'r1', { intervalMs: 600 });
  console.log(
    '改间隔   :',
    patched && patched.intervalMs,
    '| 读回',
    KC.store.rulesFor(origin)[0].intervalMs,
    '(expect 600 | 600)',
  );
  const badPatch = await KC.store.patchRule(origin, 'r1', { steps: [] });
  console.log(
    '非法补丁 :',
    JSON.stringify(badPatch),
    '| 原规则保持',
    KC.store.rulesFor(origin).length,
    KC.store.rulesFor(origin)[0].intervalMs,
    '(expect null | 1 600)',
  );
  const withGap = await KC.store.patchRule(origin, 'r1', {
    steps: [{ ...KC.store.rulesFor(origin)[0].steps[0], gapMs: 800 }],
  });
  console.log(
    '逐步覆盖 :',
    withGap && withGap.steps[0].gapMs,
    '| 读回',
    KC.store.rulesFor(origin)[0].steps[0].gapMs,
    '| 统一间隔仍在',
    withGap && withGap.intervalMs,
    '(expect 800 | 800 | 600)',
  );

  const created = await KC.store.createScheme(origin, '大屏');
  console.log(
    '新建方案 :',
    created.name,
    'active:', KC.store.activeSchemeName(origin),
    'copied:', KC.store.rulesFor(origin).length,
    '(expect 1)',
  );
  const dup = await KC.store.createScheme(origin, '大屏');
  console.log('重名去重 :', dup.name, '(expect 大屏 (2))');

  await KC.store.setActiveScheme(origin, '大屏');
  await KC.store.removeRule(origin, 'r1');
  console.log('按方案隔离:', '大屏 rules:', KC.store.rulesFor(origin).length, '(expect 0)');

  const deleted = await KC.store.deleteScheme(origin, '大屏');
  console.log('删除方案 :', JSON.stringify(deleted), 'active:', KC.store.activeSchemeName(origin));
  await KC.store.deleteScheme(origin, '大屏 (2)');
  console.log('方案列表 :', KC.store.schemeNames(origin).join('|'), '(expect 默认)');
  const last = await KC.store.deleteScheme(origin, KC.store.activeSchemeName(origin));
  console.log('禁止删空 :', JSON.stringify(last), '(expect ok:false)');
}

// 标记浮层：单步只显示符号，多步显示「序号 + 符号」，位置按 canvas 归一化反算
if (KC && KC.markers && KC.store) {
  console.log('--- markers ---');
  await KC.store.upsertRule(KC.origin, {
    id: 'g1',
    name: '',
    shortcut: { shift: true, code: 'KeyH', key: 'H' },
    steps: [step(0.25, 0.5), step(0.5, 0.5), step(0.75, 0.5)],
    intervalMs: KC.DEFAULT_STEP_INTERVAL_MS,
  });
  KC.markers.render();
  const layer = KC.hint
    .ensure()
    .children.find((el) => el.className === 'kc-markers');
  layer.children.length = 0;
  KC.markers.render();
  console.log(
    '标记文本 :',
    layer.children.map((el) => el.textContent).join(' | '),
    '(expect H | 1 ⇧H | 2 ⇧H | 3 ⇧H)',
  );
  console.log(
    '标记位置 :',
    layer.children.map((el) => `${el.style.left},${el.style.top}`).join(' '),
    '(expect 640px,360px 320px,360px 640px,360px 960px,360px)',
  );
}

// 坐标解析：没落在 canvas 上的点按视口像素直接命中且不算异常，落在 canvas 上的点走归一化反算
if (KC && KC.clicker) {
  console.log('--- resolve ---');
  const raw = KC.clicker.resolveTarget({ nx: null, ny: null, x: 512, y: 384, canvas: null }, null);
  console.log(
    '原始坐标 :',
    raw && `${raw.x},${raw.y}`,
    '| 警告', raw && raw.warnings.length,
    '| 无 canvas', raw && raw.canvas === null,
    '(expect 512,384 | 0 | true)',
  );
  const norm = KC.clicker.resolveTarget(step(0.25, 0.5), null);
  console.log(
    '归一化   :',
    norm && `${norm.x},${norm.y}`,
    '| 警告', norm && norm.warnings.length,
    '(expect 320,360 | 0)',
  );
}

// 组播放与取消语义
if (KC && KC.clicker) {
  console.log('--- clicker ---');
  const settings = { holdMs: 0, hintOpacity: 0.3, hintDurationMs: 900 };
  const group = {
    id: 'g1',
    shortcut: { shift: true, code: 'KeyH', key: 'H' },
    steps: [step(0.25, 0.5), step(0.5, 0.5), step(0.75, 0.5)],
    intervalMs: 20,
    env: { vw: 1280, vh: 720, dpr: 1 },
  };

  const seen = [];
  const running = KC.clicker.trigger(group, settings, (s) =>
    seen.push(`${s.index + 1}/${s.total}@${s.x}`),
  );
  const second = await KC.clicker.trigger(group, settings);
  console.log(
    '播放中再按:',
    'cancelled', second.cancelled,
    '| interrupted', second.interrupted,
    '| steps', second.steps.length,
    '(expect true | true | 0)',
  );
  const first = await running;
  console.log(
    '被取消的组:',
    'clicked', first.steps.length,
    '| cancelled', first.cancelled,
    '| interrupted', !!first.interrupted,
    '| onStep', seen.join(','),
    '(expect 1 | true | false | 1/3@320)',
  );

  const replay = await KC.clicker.trigger(group, settings);
  console.log(
    '取消后重播:',
    'clicked', replay.steps.length,
    '| cancelled', replay.cancelled,
    '| warnings', replay.warnings.length,
    '(expect 3 | false | 0)',
  );

  const perStep = {
    id: 'g2',
    shortcut: { code: 'KeyJ', key: 'j' },
    steps: [{ ...step(0.25, 0.5), gapMs: 0 }, step(0.5, 0.5), step(0.75, 0.5)],
    intervalMs: 120,
  };
  const stamps = [];
  const perStepRes = await KC.clicker.trigger(perStep, settings, () => stamps.push(Date.now()));
  const gaps = stamps.slice(1).map((t, i) => t - stamps[i]);
  console.log(
    '逐步间隔 :',
    'clicked', perStepRes.steps.length,
    '| 第1步覆盖为 0 几乎不等待', gaps[0] < 60,
    `(${gaps[0]}ms)`,
    '| 第2步跟随统一 120ms', gaps[1] >= 100,
    `(${gaps[1]}ms)`,
    '(expect 3 | true | true)',
  );

  const interrupted = KC.clicker.trigger(group, settings);
  KC.clicker.cancelAll();
  const stopped = await interrupted;
  const afterCancelAll = await KC.clicker.trigger(group, settings);
  console.log(
    'cancelAll:',
    'clicked', stopped.steps.length,
    '| cancelled', stopped.cancelled,
    '| 运行表已清空', !afterCancelAll.interrupted && afterCancelAll.steps.length === 3,
    '(expect 1 | true | true)',
  );
}

// 录制：穿透开关决定左键是否传给页面；右键撤销手势在两种模式下都被吞掉
if (KC && KC.recorder && KC.store) {
  console.log('--- recorder ---');
  const draftLayer = () =>
    KC.hint.ensure().querySelector('.kc-hint-root').querySelector('.kc-drafts');
  const draftCount = () => draftLayer().children.length;
  const click = (init) =>
    globalThis.__fireWindow(
      new FakeEvent('pointerdown', { button: 0, target: fakeCanvas, ...init }),
    );
  // 真实 KeyboardEvent 的修饰键字段一定是布尔值，matchesEvent 用的又是严格相等，
  // 留成 undefined 会让自检永远匹配不上
  const press = (init) =>
    globalThis.__fireWindow(
      new FakeEvent('keydown', {
        repeat: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        ...init,
      }),
    );

  await KC.store.updateSettings({ recordPassthrough: false });
  KC.recorder.start();
  const swallowed = click({ clientX: 320, clientY: 360 });
  const recordedWhileBlocked = draftCount();
  const undone = click({ button: 2, clientX: 320, clientY: 360 });
  console.log(
    '拦截模式 :',
    '左键被吞', swallowed.defaultPrevented,
    '| 仍记录了点', recordedWhileBlocked,
    '| 右键也被吞', undone.defaultPrevented,
    '| 撤销后剩余', draftCount(),
    '(expect true | 1 | true | 0)',
  );
  KC.recorder.cancel();

  await KC.store.updateSettings({ recordPassthrough: true });
  KC.recorder.start();
  const through = click({ clientX: 640, clientY: 360 });
  console.log(
    '穿透模式 :',
    '左键被吞', through.defaultPrevented,
    '| 仍记录了点', draftCount(),
    '(expect false | 1)',
  );
  click({ clientX: 960, clientY: 360 });
  press({ code: 'KeyZ', key: 'z' });
  press({ code: 'KeyZ', key: 'z' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const saved = KC.store.rulesFor(KC.origin).find((rule) => rule.shortcut.code === 'KeyZ');
  console.log(
    '录制保存 :',
    saved ? `${saved.steps.length} 步` : 'MISSING',
    '| 间隔', saved && saved.intervalMs,
    '| 归一化', saved && saved.steps.map((s) => `${s.nx},${s.ny}`).join(' '),
    '| 录制已复位', !KC.recorder.isActive(),
    `(expect 2 步 | ${KC.DEFAULT_STEP_INTERVAL_MS} | 0.5,0.5 0.75,0.5 | true)`,
  );
  if (saved) await KC.store.removeRule(KC.origin, saved.id);
}

setTimeout(() => {
  console.log(failed ? 'SMOKE: FAILED' : 'SMOKE: PASSED');
  process.exit(failed ? 1 : 0);
}, 1500);
