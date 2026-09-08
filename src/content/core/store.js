(() => {
  const KC = self.KEYCLICK;
  const { STORAGE_KEY, DEFAULT_SCHEME, DEFAULT_STEP_INTERVAL_MS, emptyProfile } = KC;

  let cache = null;
  let loading = null;

  // 只做形状约束，不做旧版本迁移：没有可用 steps 的规则直接丢弃
  function normalizeRule(rule) {
    if (!rule || typeof rule !== 'object') return null;
    const steps = Array.isArray(rule.steps)
      ? rule.steps.filter((step) => step && typeof step === 'object')
      : [];
    if (!steps.length) return null;
    const intervalMs = Number(rule.intervalMs);
    return {
      ...rule,
      steps,
      intervalMs:
        Number.isFinite(intervalMs) && intervalMs >= 0 ? intervalMs : DEFAULT_STEP_INTERVAL_MS,
    };
  }

  function normalizeRules(rules) {
    if (!Array.isArray(rules)) return [];
    return rules.map(normalizeRule).filter(Boolean);
  }

  function normalizeSite(site) {
    const raw = site && typeof site === 'object' ? site : {};
    const schemes = {};
    if (raw.schemes && typeof raw.schemes === 'object') {
      for (const [name, scheme] of Object.entries(raw.schemes)) {
        if (!name) continue;
        schemes[name] = { rules: normalizeRules(scheme && scheme.rules) };
      }
    }
    if (!Object.keys(schemes).length) schemes[DEFAULT_SCHEME] = { rules: [] };
    const activeScheme = schemes[raw.activeScheme] ? raw.activeScheme : Object.keys(schemes)[0];
    return { enabled: raw.enabled !== false, activeScheme, schemes };
  }

  function normalize(profile) {
    const base = emptyProfile();
    if (!profile || typeof profile !== 'object') return base;
    const sites = {};
    if (profile.sites && typeof profile.sites === 'object') {
      for (const [origin, site] of Object.entries(profile.sites)) {
        if (!origin) continue;
        sites[origin] = normalizeSite(site);
      }
    }
    return {
      version: KC.VERSION,
      settings: KC.normalizeSettings(profile.settings),
      sites,
    };
  }

  async function load() {
    if (cache) return cache;
    if (!loading) {
      loading = chrome.storage.local.get(STORAGE_KEY).then((data) => {
        cache = normalize(data[STORAGE_KEY]);
        loading = null;
        return cache;
      });
    }
    return loading;
  }

  async function save(profile) {
    cache = normalize(profile);
    await chrome.storage.local.set({ [STORAGE_KEY]: cache });
    KC.emit('profile', cache);
    return cache;
  }

  // 同步读取内存缓存，供 keydown 等热路径使用；init 之后缓存必然已就绪
  function current() {
    return cache;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    cache = normalize(changes[STORAGE_KEY].newValue);
    KC.emit('profile', cache);
  });

  function newSite() {
    return { enabled: true, activeScheme: DEFAULT_SCHEME, schemes: { [DEFAULT_SCHEME]: { rules: [] } } };
  }

  function siteOf(profile, origin, create) {
    if (!profile.sites[origin] && create) profile.sites[origin] = newSite();
    return profile.sites[origin] || null;
  }

  function schemeNames(origin) {
    const site = cache && siteOf(cache, origin);
    return site ? Object.keys(site.schemes) : [];
  }

  function activeSchemeName(origin) {
    const site = cache && siteOf(cache, origin);
    return site ? site.activeScheme : DEFAULT_SCHEME;
  }

  function rulesFor(origin) {
    const site = cache && siteOf(cache, origin);
    if (!site) return [];
    const scheme = site.schemes[site.activeScheme];
    return scheme ? scheme.rules : [];
  }

  function findRule(origin, event) {
    return rulesFor(origin).find((rule) => KC.hotkeys.matchesEvent(rule, event)) || null;
  }

  async function setActiveScheme(origin, name) {
    const profile = await load();
    const site = siteOf(profile, origin, true);
    if (!site.schemes[name]) return { ok: false, reason: '方案不存在' };
    site.activeScheme = name;
    await save(profile);
    return { ok: true, name };
  }

  function uniqueName(schemes, wanted) {
    const base = String(wanted || '').trim() || DEFAULT_SCHEME;
    if (!schemes[base]) return base;
    for (let i = 2; i < 100; i += 1) {
      const candidate = `${base} (${i})`;
      if (!schemes[candidate]) return candidate;
    }
    return `${base} (${Date.now()})`;
  }

  // 新方案一律从空列表开始：复制会让两个方案看起来一模一样，用户分不清有没有切换成功
  async function createScheme(origin, name) {
    const profile = await load();
    const site = siteOf(profile, origin, true);
    const finalName = uniqueName(site.schemes, name);
    site.schemes[finalName] = { rules: [] };
    site.activeScheme = finalName;
    await save(profile);
    return { ok: true, name: finalName };
  }

  async function renameScheme(origin, from, to) {
    const profile = await load();
    const site = siteOf(profile, origin, true);
    if (!site.schemes[from]) return { ok: false, reason: '方案不存在' };
    const finalName = String(to || '').trim();
    if (!finalName) return { ok: false, reason: '方案名不能为空' };
    if (finalName === from) return { ok: true, name: from };
    if (site.schemes[finalName]) return { ok: false, reason: '已存在同名方案' };

    // 重建对象以保持方案顺序，替换处沿用原位置
    const schemes = {};
    for (const [key, scheme] of Object.entries(site.schemes)) {
      schemes[key === from ? finalName : key] = scheme;
    }
    site.schemes = schemes;
    if (site.activeScheme === from) site.activeScheme = finalName;
    await save(profile);
    return { ok: true, name: finalName };
  }

  async function deleteScheme(origin, name) {
    const profile = await load();
    const site = siteOf(profile, origin);
    if (!site || !site.schemes[name]) return { ok: false, reason: '方案不存在' };
    const names = Object.keys(site.schemes);
    if (names.length <= 1) return { ok: false, reason: '至少要保留一个方案' };
    delete site.schemes[name];
    if (site.activeScheme === name) site.activeScheme = Object.keys(site.schemes)[0];
    await save(profile);
    return { ok: true };
  }

  async function upsertRule(origin, rule) {
    const profile = await load();
    const site = siteOf(profile, origin, true);
    const scheme = site.schemes[site.activeScheme];
    const index = scheme.rules.findIndex((r) => r.id === rule.id);
    if (index >= 0) scheme.rules[index] = rule;
    else scheme.rules.push(rule);
    await save(profile);
    return rule;
  }

  async function removeRule(origin, id) {
    const profile = await load();
    const site = siteOf(profile, origin);
    const scheme = site && site.schemes[site.activeScheme];
    if (!scheme) return;
    scheme.rules = scheme.rules.filter((r) => r.id !== id);
    await save(profile);
  }

  async function patchRule(origin, id, patch) {
    const profile = await load();
    const site = siteOf(profile, origin);
    const scheme = site && site.schemes[site.activeScheme];
    if (!scheme) return null;
    const index = scheme.rules.findIndex((r) => r.id === id);
    if (index < 0) return null;
    const merged = normalizeRule({ ...scheme.rules[index], ...patch });
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

  KC.store = {
    load,
    save,
    current,
    normalize,
    normalizeSite,
    siteOf,
    schemeNames,
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
