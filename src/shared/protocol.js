// Service Worker 与内容脚本共用的协议：schema 常量、归一化、版本迁移。
// 内容脚本通过 manifest 的 js 数组按顺序加载；SW 通过 importScripts 加载。
// 两侧都运行在各自隔离的全局作用域里，因此直接挂到 self 上不会污染宿主页面。
//
// 本文件必须保持纯净：不碰 DOM，也不碰 chrome.storage。
// 它是两侧唯一的共享实现，一旦引入环境依赖，SW 与内容脚本就会各自漂移出第二份逻辑。
(() => {
  // schema 版本，整数。与扩展版本（manifest 里的 semver）各自独立演进：
  // 扩展可以发十几个版本而 schema 一直停在 1，只要改动都是纯加法。
  const VERSION = 1;

  // 旧 key 是 'profile'（测试期的 v1/2/3 数据都在里面）。换 key 是版本号能归零的前提：
  // 旧数据写的是 version 3，若共用一个 key 会被误判成「来自未来版本」而永久只读。
  const STORAGE_KEY = 'coordkey';
  const LEGACY_STORAGE_KEYS = ['profile'];

  const DEFAULT_SCHEME = '默认';
  // 新录制的组默认的步间隔；每条规则各自保存，可在面板里改
  const DEFAULT_STEP_INTERVAL_MS = 120;

  const DEFAULT_SETTINGS = {
    enabled: true,
    holdMs: 50,
    skipInInput: true,
    // 录制时左键是否照常传给页面。关掉后点击被扩展吞掉，页面不会响应（只用来取坐标）
    recordPassthrough: true,
    showMarkers: true,
    hintOpacity: 0.3,
    hintDurationMs: 900,
  };

  const manifest =
    typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest
      ? chrome.runtime.getManifest()
      : null;
  // 版本号的唯一事实来源是 manifest，界面与导出都读这里，不另存一份字符串
  const APP_VERSION = manifest ? manifest.version : '';

  function isObject(value) {
    return !!value && typeof value === 'object';
  }

  function uid(prefix = 'r_') {
    return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  }

  function emptyProfile() {
    return { version: VERSION, settings: { ...DEFAULT_SETTINGS }, sites: {} };
  }

  // ---------------------------------------------------------------------------
  // 归一化
  //
  // 统一原则：已知字段缺失就补默认，未知字段一律原样保留。
  // 「保留」是硬要求而非宽容——未来版本新增的字段必须能安全穿过旧代码的一次读写往返，
  // 否则用户降级一次扩展，新版本存下的数据就被洗掉了。代价是废弃的设置项会留在数据里，
  // 但没人读它，无害。
  // ---------------------------------------------------------------------------

  function normalizeSettings(raw) {
    const settings = { ...(isObject(raw) ? raw : {}) };
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (settings[key] === undefined) settings[key] = DEFAULT_SETTINGS[key];
    }
    return settings;
  }

  // 只做形状约束：丢弃没有有效 steps 的规则，给缺失的 intervalMs / id 补上
  function normalizeRule(rule) {
    if (!isObject(rule)) return null;
    const steps = Array.isArray(rule.steps) ? rule.steps.filter(isObject) : [];
    if (!steps.length) return null;
    const intervalMs = Number(rule.intervalMs);
    const repeatCount = Number(rule.repeatCount);
    const repeatIntervalMs = Number(rule.repeatIntervalMs);
    return {
      ...rule,
      id: typeof rule.id === 'string' && rule.id ? rule.id : uid(),
      steps,
      intervalMs:
        Number.isFinite(intervalMs) && intervalMs >= 0 ? intervalMs : DEFAULT_STEP_INTERVAL_MS,
      repeatCount:
        Number.isFinite(repeatCount) && repeatCount >= 1 ? Math.floor(repeatCount) : 1,
      repeatIntervalMs:
        Number.isFinite(repeatIntervalMs) && repeatIntervalMs >= 0 ? Math.round(repeatIntervalMs) : null,
    };
  }

  function normalizeScheme(scheme) {
    const raw = isObject(scheme) ? scheme : {};
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    return {
      ...raw,
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid('sc_'),
      name: name || DEFAULT_SCHEME,
      rules: Array.isArray(raw.rules) ? raw.rules.map(normalizeRule).filter(Boolean) : [],
    };
  }

  function normalizeSite(site) {
    const raw = isObject(site) ? site : {};
    const schemes = Array.isArray(raw.schemes) ? raw.schemes.map(normalizeScheme) : [];
    // 至少要有一个方案，否则 activeSchemeId 无处可指，面板也没东西可选
    if (!schemes.length) schemes.push(normalizeScheme({}));
    const activeSchemeId = schemes.some((s) => s.id === raw.activeSchemeId)
      ? raw.activeSchemeId
      : schemes[0].id;
    return { ...raw, enabled: raw.enabled !== false, activeSchemeId, schemes };
  }

  function normalizeProfile(profile, version = VERSION) {
    if (!isObject(profile)) return { ...emptyProfile(), version };
    const sites = {};
    if (isObject(profile.sites)) {
      for (const [origin, site] of Object.entries(profile.sites)) {
        if (origin) sites[origin] = normalizeSite(site);
      }
    }
    return {
      ...profile,
      version,
      settings: normalizeSettings(profile.settings),
      sites,
    };
  }

  // ---------------------------------------------------------------------------
  // 版本与迁移
  // ---------------------------------------------------------------------------

  // key = 源版本，value = 把它升到 key+1 的纯函数。
  //
  // 只追加、永不修改已存在的条目：改一条老迁移，等于让所有已经落盘的老数据
  // 重新走上一条从没被验证过的路径。
  //
  // 什么时候才需要写迁移？只有结构性 / 破坏性改动（改字段含义、挪字段位置、
  // 改容器形状）。新增一个带默认值的可选字段属于纯加法，不升版本也不写迁移——
  // normalizer 会自动给老数据补上默认值。
  const MIGRATIONS = {};

  function profileVersion(raw) {
    const version = Number(isObject(raw) ? raw.version : 0);
    return Number.isInteger(version) && version >= 1 ? version : 0;
  }

  // 唯一的读取入口：先迁移，再归一化。store 与导入都走这里，不允许有第二条路径。
  // 返回的 foreign 非 0 表示数据来自更新版本的 CoordKey，调用方应当转为只读。
  function loadProfile(raw) {
    const version = profileVersion(raw);
    if (!version) return { profile: emptyProfile(), foreign: 0 };

    if (version > VERSION) {
      // 用户装了比数据更旧的扩展。不迁移、也不把版本号写低：既然版本只为结构性改动
      // 递增，旧代码就无法正确理解新结构，写回去等于给一份旧形状的数据盖上新版本的章，
      // 用户再升级时迁移链会跳过这一级，数据永久损坏。只读是唯一自洽的选择。
      return { profile: normalizeProfile(raw, version), foreign: version };
    }

    let data = raw;
    for (let v = version; v < VERSION; v += 1) {
      const step = MIGRATIONS[v];
      data = step ? step(data) : data;
    }
    return { profile: normalizeProfile(data, VERSION), foreign: 0 };
  }

  self.COORDKEY = Object.assign(self.COORDKEY || {}, {
    VERSION,
    APP_VERSION,
    STORAGE_KEY,
    LEGACY_STORAGE_KEYS,
    DEFAULT_SCHEME,
    DEFAULT_SETTINGS,
    DEFAULT_STEP_INTERVAL_MS,
    uid,
    emptyProfile,
    profileVersion,
    loadProfile,
    normalizeSettings,
    normalizeRule,
    normalizeScheme,
    normalizeSite,
    normalizeProfile,
  });
})();
