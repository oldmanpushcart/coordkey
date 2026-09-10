importScripts('../shared/protocol.js', '../shared/i18n.js', '../shared/locale-zh.js', '../shared/locale-en.js');

const { STORAGE_KEY, LEGACY_STORAGE_KEYS, emptyProfile } = self.COORDKEY;
const CK = self.COORDKEY;
const { t } = CK.i18n;

CK.i18n.init();

// SW 只读一个布尔、只写一个布尔，绝不把整份 profile 归一化后写回：
// 它看不懂内容脚本（或更新版本的扩展）存下的字段，整体重写会把这些字段抹掉。
async function readRaw() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const raw = data[STORAGE_KEY];
  return raw && typeof raw === 'object' ? raw : null;
}

// 缺数据时按「已启用」显示，与内容脚本 DEFAULT_SETTINGS.enabled 一致
function isEnabled(raw) {
  return !raw || !raw.settings || raw.settings.enabled !== false;
}

async function syncLang() {
  const raw = await readRaw();
  CK.i18n.init(raw && raw.settings && raw.settings.lang);
}

function updateBadge(enabled) {
  chrome.action.setBadgeText({ text: enabled ? '' : 'OFF' });
  chrome.action.setBadgeBackgroundColor({ color: '#c0392b' });
  chrome.action.setTitle({
    title: enabled ? t('sw.enabledTitle') : t('sw.disabledTitle'),
  });
}

chrome.action.onClicked.addListener(async () => {
  const raw = (await readRaw()) || emptyProfile();
  raw.settings = { ...raw.settings, enabled: !isEnabled(raw) };
  await chrome.storage.local.set({ [STORAGE_KEY]: raw });
  updateBadge(raw.settings.enabled);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STORAGE_KEY]) return;
  const newValue = changes[STORAGE_KEY].newValue;
  if (newValue && newValue.settings) syncLang();
  updateBadge(isEnabled(newValue));
});

chrome.runtime.onInstalled.addListener(async () => {
  // 换 STORAGE_KEY 之前遗留的测试期数据，留着只会白占空间
  await chrome.storage.local.remove(LEGACY_STORAGE_KEYS);
  if (!(await readRaw())) await chrome.storage.local.set({ [STORAGE_KEY]: emptyProfile() });
  await syncLang();
  updateBadge(isEnabled(await readRaw()));
});

syncLang().then(() => readRaw().then((raw) => updateBadge(isEnabled(raw))));
