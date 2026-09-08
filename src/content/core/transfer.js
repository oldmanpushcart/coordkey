(() => {
  const KC = self.KEYCLICK;

  async function exportAll() {
    const profile = await KC.store.load();
    const payload = {
      version: KC.VERSION,
      exportedAt: new Date().toISOString(),
      settings: profile.settings,
      sites: profile.sites,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `keyclick-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    KC.hint.toast('设置已导出为 JSON 文件', 'ok');
  }

  function isValidStep(step) {
    return (
      !!step &&
      typeof step === 'object' &&
      Number.isFinite(step.nx) &&
      Number.isFinite(step.ny) &&
      Number.isFinite(step.x) &&
      Number.isFinite(step.y)
    );
  }

  function isValidRule(rule) {
    return (
      !!rule &&
      typeof rule === 'object' &&
      !!rule.shortcut &&
      typeof rule.shortcut.code === 'string' &&
      Array.isArray(rule.steps) &&
      rule.steps.length > 0 &&
      rule.steps.every(isValidStep)
    );
  }

  function parse(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { error: '不是合法的 JSON 文件' };
    }
    if (!data || typeof data !== 'object') return { error: '文件格式不正确' };
    if (Number(data.version) !== KC.VERSION) {
      return { error: `不支持的配置版本 ${data.version}（当前为 ${KC.VERSION}）` };
    }
    if (!data.sites || typeof data.sites !== 'object') return { error: '缺少 sites 字段' };

    const sites = {};
    let ruleCount = 0;
    for (const [origin, raw] of Object.entries(data.sites)) {
      if (!origin || !raw || typeof raw !== 'object') continue;
      const site = KC.store.normalizeSite(raw);
      for (const scheme of Object.values(site.schemes)) {
        scheme.rules = scheme.rules.filter(isValidRule);
        ruleCount += scheme.rules.length;
      }
      sites[origin] = site;
    }
    if (!ruleCount) return { error: '文件中没有任何有效规则' };

    return {
      ok: true,
      sites,
      settings: data.settings && typeof data.settings === 'object' ? data.settings : null,
      siteCount: Object.keys(sites).length,
      ruleCount,
    };
  }

  function pickFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.style.display = 'none';
      document.body.appendChild(input);

      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        input.remove();
        resolve(value);
      };
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) return done(null);
        const reader = new FileReader();
        reader.onload = () => done(parse(String(reader.result)));
        reader.onerror = () => done({ error: '读取文件失败' });
        reader.readAsText(file);
      });
      input.addEventListener('cancel', () => done(null));
      input.click();
    });
  }

  function withId(rule) {
    return { ...rule, id: typeof rule.id === 'string' && rule.id ? rule.id : KC.uid() };
  }

  async function applyImport(result, mode) {
    const profile = await KC.store.load();
    if (mode === 'overwrite' && result.settings) {
      profile.settings = KC.store.normalize({ settings: result.settings }).settings;
    }
    for (const [origin, incoming] of Object.entries(result.sites)) {
      const existing = profile.sites[origin] || KC.store.normalizeSite({});
      if (mode === 'overwrite') {
        existing.enabled = incoming.enabled;
        existing.schemes = {};
        for (const [name, scheme] of Object.entries(incoming.schemes)) {
          existing.schemes[name] = { rules: scheme.rules.map(withId) };
        }
        existing.activeScheme = existing.schemes[incoming.activeScheme]
          ? incoming.activeScheme
          : Object.keys(existing.schemes)[0];
      } else {
        for (const [name, scheme] of Object.entries(incoming.schemes)) {
          if (!existing.schemes[name]) existing.schemes[name] = { rules: [] };
          const target = existing.schemes[name];
          const taken = new Set(target.rules.map((r) => KC.hotkeys.comboId(r.shortcut)));
          for (const rule of scheme.rules) {
            const id = KC.hotkeys.comboId(rule.shortcut);
            if (taken.has(id)) continue;
            taken.add(id);
            target.rules.push(withId(rule));
          }
        }
      }
      profile.sites[origin] = existing;
    }
    await KC.store.save(profile);
  }

  async function promptImport() {
    const result = await pickFile();
    if (!result) return;
    if (result.error) {
      KC.hint.toast(result.error, 'error', 4200);
      return;
    }

    const slot = KC.panel.importSlot();
    slot.textContent = '';
    const box = document.createElement('div');
    box.className = 'kc-import-box';
    box.innerHTML = `
      <div>检测到 <b>${result.siteCount}</b> 个站点、<b>${result.ruleCount}</b> 条规则。</div>
      <div class="kc-row2">
        <button class="kc-btn" type="button" data-mode="overwrite">覆盖已有</button>
        <button class="kc-btn" type="button" data-mode="skip">跳过已有</button>
      </div>
      <div class="kc-row2">
        <button class="kc-btn" type="button" data-mode="cancel">取消</button>
      </div>`;
    slot.appendChild(box);

    box.addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-mode]');
      if (!btn) return;
      const mode = btn.dataset.mode;
      slot.textContent = '';
      if (mode === 'cancel') return;
      await applyImport(result, mode);
      KC.hint.toast(`导入完成（${mode === 'overwrite' ? '覆盖' : '跳过'}策略）`, 'ok');
    });
  }

  KC.transfer = { exportAll, promptImport };
})();
