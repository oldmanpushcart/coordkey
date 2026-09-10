(() => {
  const CK = self.COORDKEY;
  const { STORAGE_KEY, DEFAULT_SCHEME } = CK;
  const t = (key) => CK.i18n.t(key);

  let cache = null;
  let loading = null;
  // 非 0 表示存储里的数据来自更新版本的 CoordKey，此时转为只读，见 protocol.js 的 loadProfile
  let foreign = 0;

  function apply(raw) {
    const result = CK.loadProfile(raw);
    cache = result.profile;
    foreign = result.foreign;
    return cache;
  }

  async function load() {
    if (cache) return cache;
    if (!loading) {
      loading = chrome.storage.local.get(STORAGE_KEY).then((data) => {
        loading = null;
        return apply(data[STORAGE_KEY]);
      });
    }
    return loading;
  }

  async function save(profile) {
    cache = CK.normalizeProfile(profile, foreign || CK.VERSION);
    // 只读模式下不落盘：宁可丢掉这次改动，也不把看不懂的字段写坏
    if (!foreign) await chrome.storage.local.set({ [STORAGE_KEY]: cache });
    CK.emit('profile', cache);
    return cache;
  }

  // 同步读取内存缓存，供 keydown 等热路径使用；init 之后缓存必然已就绪
  function current() {
    return cache;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    apply(changes[STORAGE_KEY].newValue);
    CK.emit('profile', cache);
  });

  function newSite() {
    const scheme = CK.normalizeScheme({ name: DEFAULT_SCHEME });
    return { enabled: true, activeSchemeId: scheme.id, schemes: [scheme] };
  }

  function siteOf(profile, origin, create) {
    if (!profile.sites[origin] && create) profile.sites[origin] = newSite();
    return profile.sites[origin] || null;
  }

  // 方案的身份是 id，名字只是展示用的标签
  function schemeById(site, id) {
    return site.schemes.find((scheme) => scheme.id === id) || null;
  }

  function activeSchemeOf(profile, origin, create) {
    const site = siteOf(profile, origin, create);
    if (!site) return null;
    return schemeById(site, site.activeSchemeId) || site.schemes[0] || null;
  }

  function schemesFor(origin) {
    const site = cache && siteOf(cache, origin);
    return site ? site.schemes : [];
  }

  function activeScheme(origin) {
    return cache && activeSchemeOf(cache, origin);
  }

  function activeSchemeName(origin) {
    const scheme = activeScheme(origin);
    return scheme ? scheme.name : DEFAULT_SCHEME;
  }

  function rulesFor(origin) {
    const scheme = activeScheme(origin);
    return scheme ? scheme.rules : [];
  }

  function findRule(origin, event) {
    return rulesFor(origin).find((rule) => CK.hotkeys.matchesEvent(rule, event)) || null;
  }

  async function setActiveScheme(origin, id) {
    const profile = await load();
    const site = siteOf(profile, origin, true);
    const scheme = schemeById(site, id);
    if (!scheme) return { ok: false, reason: t('store.schemeNotFound') };
    site.activeSchemeId = id;
    await save(profile);
    return { ok: true, id, name: scheme.name };
  }

  function uniqueName(schemes, wanted) {
    const taken = new Set(schemes.map((scheme) => scheme.name));
    const base = String(wanted || '').trim() || DEFAULT_SCHEME;
    if (!taken.has(base)) return base;
    for (let i = 2; i < 100; i += 1) {
      const candidate = `${base} (${i})`;
      if (!taken.has(candidate)) return candidate;
    }
    return `${base} (${Date.now()})`;
  }

  // 新方案一律从空列表开始：复制会让两个方案看起来一模一样，用户分不清有没有切换成功
  async function createScheme(origin, name) {
    const profile = await load();
    const site = siteOf(profile, origin, true);
    const scheme = CK.normalizeScheme({ name: uniqueName(site.schemes, name) });
    site.schemes.push(scheme);
    site.activeSchemeId = scheme.id;
    await save(profile);
    return { ok: true, id: scheme.id, name: scheme.name };
  }

  async function renameScheme(origin, id, to) {
    const profile = await load();
    const site = siteOf(profile, origin, true);
    const scheme = schemeById(site, id);
    if (!scheme) return { ok: false, reason: t('store.schemeNotFound') };
    const name = String(to || '').trim();
    if (!name) return { ok: false, reason: t('store.schemeNameEmpty') };
    if (name === scheme.name) return { ok: true, id, name };
    // 同名方案在下拉框里分不清切到了哪个，所以名字仍然要求唯一——这是展示约束，不是身份约束
    if (site.schemes.some((other) => other.name === name)) {
      return { ok: false, reason: t('store.schemeNameExists') };
    }
    scheme.name = name;
    await save(profile);
    return { ok: true, id, name };
  }

  async function deleteScheme(origin, id) {
    const profile = await load();
    const site = siteOf(profile, origin);
    if (!site || !schemeById(site, id)) return { ok: false, reason: t('store.schemeNotFound') };
    if (site.schemes.length <= 1) return { ok: false, reason: t('store.schemeMinOne') };
    site.schemes = site.schemes.filter((scheme) => scheme.id !== id);
    if (site.activeSchemeId === id) site.activeSchemeId = site.schemes[0].id;
    await save(profile);
    return { ok: true };
  }

  async function upsertRule(origin, rule) {
    const profile = await load();
    const scheme = activeSchemeOf(profile, origin, true);
    const index = scheme.rules.findIndex((r) => r.id === rule.id);
    if (index >= 0) scheme.rules[index] = rule;
    else scheme.rules.push(rule);
    await save(profile);
    return rule;
  }

  async function removeRule(origin, id) {
    const profile = await load();
    const scheme = activeSchemeOf(profile, origin);
    if (!scheme) return;
    scheme.rules = scheme.rules.filter((r) => r.id !== id);
    await save(profile);
  }

  async function patchRule(origin, id, patch) {
    const profile = await load();
    const scheme = activeSchemeOf(profile, origin);
    if (!scheme) return null;
    const index = scheme.rules.findIndex((r) => r.id === id);
    if (index < 0) return null;
    const merged = CK.normalizeRule({ ...scheme.rules[index], ...patch });
    if (!merged) return null;
    scheme.rules[index] = merged;
    await save(profile);
    return merged;
  }

  async function updateSettings(patch) {
    const profile = await load();
    Object.assign(profile.settings, patch);
    await save(profile);
    return profile.settings;
  }

  CK.store = {
    load,
    save,
    current,
    foreignVersion: () => foreign,
    siteOf,
    schemeById,
    activeSchemeOf,
    schemesFor,
    activeScheme,
    activeSchemeName,
    setActiveScheme,
    createScheme,
    renameScheme,
    deleteScheme,
    rulesFor,
    findRule,
    upsertRule,
    removeRule,
    patchRule,
    updateSettings,
  };
})();
