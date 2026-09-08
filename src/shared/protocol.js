// Service Worker 与内容脚本共用的协议常量。
// 内容脚本通过 manifest 的 js 数组按顺序加载；SW 通过 importScripts 加载。
// 两侧都运行在各自隔离的全局作用域里，因此直接挂到 self 上不会污染宿主页面。
(() => {
  const VERSION = 3;
  const STORAGE_KEY = 'profile';
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

  function emptyProfile() {
    return { version: VERSION, settings: { ...DEFAULT_SETTINGS }, sites: {} };
  }

  // 只保留 DEFAULT_SETTINGS 里声明过的键，升级后废弃的设置项会在下次写入时被丢弃
  function normalizeSettings(raw) {
    const settings = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      settings[key] = raw && raw[key] !== undefined ? raw[key] : DEFAULT_SETTINGS[key];
    }
    return settings;
  }

  self.KEYCLICK = Object.assign(self.KEYCLICK || {}, {
    VERSION,
    STORAGE_KEY,
    DEFAULT_SCHEME,
    DEFAULT_SETTINGS,
    DEFAULT_STEP_INTERVAL_MS,
    emptyProfile,
    normalizeSettings,
  });
})();
