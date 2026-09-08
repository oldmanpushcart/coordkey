importScripts('../shared/protocol.js');

const { STORAGE_KEY, emptyProfile, normalizeSettings } = self.KEYCLICK;

async function readProfile() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const stored = data[STORAGE_KEY];
  if (!stored || typeof stored !== 'object') return emptyProfile();
  return {
    version: self.KEYCLICK.VERSION,
    settings: normalizeSettings(stored.settings),
    sites: stored.sites && typeof stored.sites === 'object' ? stored.sites : {},
  };
}

function updateBadge(enabled) {
  chrome.action.setBadgeText({ text: enabled ? '' : 'OFF' });
  chrome.action.setBadgeBackgroundColor({ color: '#c0392b' });
  chrome.action.setTitle({
    title: enabled ? 'KeyClick：已启用（点击全局停用）' : 'KeyClick：已停用（点击启用）',
  });
}

chrome.action.onClicked.addListener(async () => {
  const profile = await readProfile();
  profile.settings.enabled = !profile.settings.enabled;
  await chrome.storage.local.set({ [STORAGE_KEY]: profile });
  updateBadge(profile.settings.enabled);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STORAGE_KEY]) return;
  const settings = changes[STORAGE_KEY].newValue?.settings;
  updateBadge(settings ? settings.enabled !== false : true);
});

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  if (!data[STORAGE_KEY]) await chrome.storage.local.set({ [STORAGE_KEY]: emptyProfile() });
  updateBadge((await readProfile()).settings.enabled);
});

readProfile().then((profile) => updateBadge(profile.settings.enabled));
