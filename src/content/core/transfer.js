(() => {
  const CK = self.COORDKEY;

  async function exportAll() {
    const profile = await CK.store.load();
    const payload = {
      // 跟着数据走而不是跟着代码走：只读模式（数据来自更新版本）下导出的是那个版本
      version: profile.version,
      appVersion: CK.APP_VERSION,
      exportedAt: new Date().toISOString(),
      settings: profile.settings,
      sites: profile.sites,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `coordkey-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    CK.hint.toast('设置已导出为 JSON 文件', 'ok');
  }

  // 判据与播放引擎对齐：clicker.resolveTarget 只要 x/y 是有限像素就能点。
  // 没落在 canvas 上的点 nx/ny 为 null，那是普通网页的正常形状，不是脏数据。
  function isValidStep(step) {
    return !!step && typeof step === 'object' && Number.isFinite(step.x) && Number.isFinite(step.y);
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

    const version = CK.profileVersion(data);
    if (!version) return { error: '文件缺少有效的配置版本号' };
    if (version > CK.VERSION) {
      return {
        error:
          `这份配置来自更新版本的 CoordKey（配置 v${version}，当前支持到 v${CK.VERSION}），` +
          '请升级扩展后再导入',
      };
    }

    // 与 store 共用同一条迁移链，导入不另立第二套读取逻辑
    const { profile } = CK.loadProfile(data);
    const sites = {};
    let ruleCount = 0;
    for (const [origin, site] of Object.entries(profile.sites)) {
      for (const scheme of site.schemes) {
        scheme.rules = scheme.rules.filter(isValidRule);
        ruleCount += scheme.rules.length;
      }
      // 规则全被过滤掉的站点不导入，否则存储里会多出一堆空站点
      if (site.schemes.some((scheme) => scheme.rules.length)) sites[origin] = site;
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

  // 导入一律重新发 id：外来 id 在本机没有意义，而且重复导入同一份文件会让一个方案里
  // 出现两条同 id 的规则，patchRule 的 findIndex 与 clicker 的运行表都会命中错的那条。
  function freshRule(rule) {
    return { ...rule, id: CK.uid() };
  }

  async function applyImport(result, mode) {
    const profile = await CK.store.load();
    // 只并 settings 与 sites：导出文件的外壳字段（exportedAt / appVersion）不属于存储内容
    if (mode === 'overwrite' && result.settings) {
      profile.settings = CK.normalizeSettings(result.settings);
    }
    for (const [origin, incoming] of Object.entries(result.sites)) {
      const existing = profile.sites[origin] || CK.normalizeSite({});
      if (mode === 'overwrite') {
        existing.enabled = incoming.enabled;
        existing.schemes = incoming.schemes.map((scheme) => ({
          ...scheme,
          id: CK.uid('sc_'),
          rules: scheme.rules.map(freshRule),
        }));
        const wanted = CK.store.schemeById(incoming, incoming.activeSchemeId);
        const match = wanted && existing.schemes.find((s) => s.name === wanted.name);
        existing.activeSchemeId = (match || existing.schemes[0]).id;
      } else {
        for (const scheme of incoming.schemes) {
          // 跨文件只能按名字匹配：id 是各自本地随机发的，两份导出之间对不上
          let target = existing.schemes.find((s) => s.name === scheme.name);
          if (!target) {
            target = CK.normalizeScheme({ name: scheme.name });
            existing.schemes.push(target);
          }
          const taken = new Set(target.rules.map((r) => CK.hotkeys.comboId(r.shortcut)));
          for (const rule of scheme.rules) {
            const combo = CK.hotkeys.comboId(rule.shortcut);
            if (taken.has(combo)) continue;
            taken.add(combo);
            target.rules.push(freshRule(rule));
          }
        }
      }
      profile.sites[origin] = existing;
    }
    await CK.store.save(profile);
  }

  async function promptImport() {
    const result = await pickFile();
    if (!result) return;
    if (result.error) {
      CK.hint.toast(result.error, 'error', 4200);
      return;
    }

    const slot = CK.panel.importSlot();
    slot.textContent = '';
    const box = document.createElement('div');
    box.className = 'ck-import-box';
    box.innerHTML = `
      <div>检测到 <b>${result.siteCount}</b> 个站点、<b>${result.ruleCount}</b> 条规则。</div>
      <div class="ck-row2">
        <button class="ck-btn" type="button" data-mode="overwrite">覆盖已有</button>
        <button class="ck-btn" type="button" data-mode="skip">跳过已有</button>
      </div>
      <div class="ck-row2">
        <button class="ck-btn" type="button" data-mode="cancel">取消</button>
      </div>`;
    slot.appendChild(box);

    box.addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-mode]');
      if (!btn) return;
      const mode = btn.dataset.mode;
      slot.textContent = '';
      if (mode === 'cancel') return;
      await applyImport(result, mode);
      CK.hint.toast(`导入完成（${mode === 'overwrite' ? '覆盖' : '跳过'}策略）`, 'ok');
    });
  }

  // parse / applyImport 一并暴露：冒烟测试要在 Node 里直接验证版本策略与「导入重发 id」，
  // 走文件选择器在桩环境下无从下手
  CK.transfer = { exportAll, promptImport, parse, applyImport };
})();
