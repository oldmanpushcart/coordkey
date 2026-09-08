(() => {
  const KC = self.KEYCLICK;

  const FAB_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <circle cx="12" cy="12" r="4.2"></circle>
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"></circle>
      <line x1="12" y1="2.5" x2="12" y2="7"></line>
      <line x1="12" y1="17" x2="12" y2="21.5"></line>
      <line x1="2.5" y1="12" x2="7" y2="12"></line>
      <line x1="17" y1="12" x2="21.5" y2="12"></line>
    </svg>`;

  let host = null;
  let root = null;
  let refs = null;
  // 规则行「展开步骤」的状态要跨重渲染保留，否则改完一步间隔列表就收起来了
  const expanded = new Set();
  // 整个规则列表的收起状态同样要跨重渲染保留：切方案、改间隔都会触发重画
  let listCollapsed = false;

  function build() {
    if (root) return;
    host = document.createElement('div');
    host.setAttribute('data-keyclick-widget', '');
    // 宿主不铺满全屏且自身不接收指针事件，否则会挡住整个页面画布
    host.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:2147483647;pointer-events:none;';
    root = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = KC.styles.WIDGET_CSS;
    root.appendChild(style);

    const box = document.createElement('div');
    box.className = 'kc-root';
    box.innerHTML = `
      <button class="kc-fab" type="button" title="KeyClick" data-state="on">${FAB_SVG}</button>
      <div class="kc-panel" data-open="false">
        <div class="kc-head">
          <span class="kc-title">KeyClick</span>
          <button class="kc-iconbtn" type="button" data-act="close" title="关闭">×</button>
        </div>

        <div class="kc-section">
          <button class="kc-btn kc-btn-primary" type="button" data-act="record">＋ 录制快捷键（连点多个位置即为顺序点击组）</button>
          <div class="kc-record-status" hidden></div>
        </div>

        <div class="kc-section">
          <div class="kc-sec-title">方案</div>
          <div class="kc-scheme-row">
            <select class="kc-select" data-scheme="select" title="切换方案"></select>
            <button class="kc-iconbtn" type="button" data-act="scheme-new" title="新建方案（复制当前方案的规则）">新建</button>
            <button class="kc-iconbtn" type="button" data-act="scheme-rename" title="重命名当前方案">改名</button>
            <button class="kc-iconbtn" type="button" data-act="scheme-delete" title="删除当前方案">删除</button>
          </div>
          <div class="kc-scheme-hint">窗口尺寸或布局不同时切换方案，各方案的快捷键互不干扰。</div>
        </div>

        <div class="kc-section">
          <div class="kc-sec-title kc-sec-head">
            <span>方案「<span class="kc-scheme-name"></span>」的规则<span class="kc-rule-count"></span> · <span class="kc-origin"></span></span>
            <button class="kc-mini" type="button" data-act="toggle-list" title="收起 / 展开快捷键列表，收起后不用滚动就能看到下面的设置"></button>
          </div>
          <div class="kc-rules"></div>
        </div>

        <div class="kc-section kc-row2">
          <button class="kc-btn" type="button" data-act="export">导出设置</button>
          <button class="kc-btn" type="button" data-act="import">导入设置</button>
        </div>
        <div class="kc-import-slot"></div>

        <div class="kc-section">
          <div class="kc-sec-title">设置</div>
          <label class="kc-switch-row"><input type="checkbox" data-setting="enabled"><span>总开关</span></label>
          <label class="kc-switch-row"><input type="checkbox" data-setting="skipInInput"><span>输入框内不触发</span></label>
          <label class="kc-switch-row" title="勾选：录制时的点击会真实传给页面，可以先操作页面切到别的界面再点下一个位置。取消：点击被扩展吞掉，页面不会响应，只用来取坐标。"><input type="checkbox" data-setting="recordPassthrough"><span>录制时点击照常生效</span></label>
          <label class="kc-switch-row"><input type="checkbox" data-setting="showMarkers"><span>显示坐标标记浮层</span></label>
          <label class="kc-field"><span>按住时长</span><span><input type="number" data-setting="holdMs" min="0" max="2000" step="10"> ms</span></label>
          <label class="kc-field"><span>浮现透明度</span><span><input type="range" data-setting="hintOpacity" min="0.05" max="1" step="0.05"><span class="kc-val"></span></span></label>
          <label class="kc-field"><span>浮现时长</span><span><input type="number" data-setting="hintDurationMs" min="200" max="5000" step="100"> ms</span></label>
        </div>
      </div>`;
    root.appendChild(box);
    document.documentElement.appendChild(host);
    KC.widgetHost = host;

    refs = {
      fab: box.querySelector('.kc-fab'),
      panel: box.querySelector('.kc-panel'),
      recordStatus: box.querySelector('.kc-record-status'),
      rules: box.querySelector('.kc-rules'),
      ruleCount: box.querySelector('.kc-rule-count'),
      listToggle: box.querySelector('[data-act="toggle-list"]'),
      origin: box.querySelector('.kc-origin'),
      scheme: box.querySelector('[data-scheme="select"]'),
      schemeName: box.querySelector('.kc-scheme-name'),
      schemeDelete: box.querySelector('[data-act="scheme-delete"]'),
      importSlot: box.querySelector('.kc-import-slot'),
    };

    box.addEventListener('click', onClick);
    box.addEventListener('change', onChange);
    box.addEventListener('input', onInput);
    refs.fab.addEventListener('click', () => toggle());

    // 点击面板外区域收起。Shadow 内容的事件在 document 层会被重定向到宿主，
    // 因此 contains(host) 即可覆盖「点在面板内」的情况。
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (!KC.state.panelOpen) return;
        if (host.contains(event.target)) return;
        close();
      },
      true,
    );
  }

  function isOpen() {
    return KC.state.panelOpen;
  }

  function open() {
    build();
    KC.state.panelOpen = true;
    refs.panel.dataset.open = 'true';
    render();
  }

  function close() {
    if (!KC.state.panelOpen) return;
    KC.state.panelOpen = false;
    if (refs) refs.panel.dataset.open = 'false';
    clearImportSlot();
  }

  function toggle() {
    isOpen() ? close() : open();
  }

  function onClick(event) {
    const btn = event.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'close') return close();
    if (act === 'record') return KC.recorder.start();
    if (act === 'export') return KC.transfer.exportAll();
    if (act === 'import') return KC.transfer.promptImport();
    if (act.startsWith('scheme-')) return onSchemeAction(act);

    if (act === 'toggle-list') {
      listCollapsed = !listCollapsed;
      renderRules();
      return;
    }

    if (act === 'expand') {
      const target = btn.dataset.id;
      if (expanded.has(target)) expanded.delete(target);
      else expanded.add(target);
      renderRules();
      return;
    }

    const id = btn.dataset.id;
    const rule = KC.store.rulesFor(KC.origin).find((r) => r.id === id);
    if (!rule) return;

    if (act === 'reset-gap') {
      const index = Number(btn.dataset.index);
      if (!rule.steps[index]) return;
      const steps = rule.steps.map((step, i) => {
        if (i !== index) return step;
        const rest = { ...step };
        delete rest.gapMs;
        return rest;
      });
      KC.store.patchRule(KC.origin, id, { steps });
      return;
    }

    if (act === 'test') return performTest(rule);
    if (act === 'rename') {
      const name = window.prompt('规则名称', rule.name || '');
      if (name != null && name.trim()) KC.store.patchRule(KC.origin, id, { name: name.trim() });
      return;
    }
    if (act === 'delete') {
      if (window.confirm(`删除快捷键「${KC.hotkeys.comboLabel(rule.shortcut)}」？`)) {
        KC.store.removeRule(KC.origin, id);
      }
    }
  }

  async function onSchemeAction(act) {
    const active = KC.store.activeSchemeName(KC.origin);

    if (act === 'scheme-new') {
      const suggested = `方案 ${KC.store.schemeNames(KC.origin).length + 1}`;
      const name = window.prompt('新方案名称（会复制当前方案的规则，便于按新窗口尺寸微调）', suggested);
      if (name == null) return;
      const res = await KC.store.createScheme(KC.origin, name.trim());
      if (res.ok) KC.hint.toast(`已创建并切换到方案「${res.name}」`, 'ok');
      return;
    }

    if (act === 'scheme-rename') {
      const name = window.prompt('重命名方案', active);
      if (name == null) return;
      const res = await KC.store.renameScheme(KC.origin, active, name);
      if (!res.ok) KC.hint.toast(res.reason, 'error');
      return;
    }

    if (act === 'scheme-delete') {
      const count = KC.store.rulesFor(KC.origin).length;
      const detail = count ? `其中的 ${count} 条快捷键会一并删除。` : '';
      if (!window.confirm(`删除方案「${active}」？${detail}`)) return;
      const res = await KC.store.deleteScheme(KC.origin, active);
      if (res.ok) KC.hint.toast(`已删除方案「${active}」`, 'ok');
      else KC.hint.toast(res.reason, 'error');
    }
  }

  async function performTest(rule) {
    const settings = KC.store.current().settings;
    const res = await KC.clicker.trigger(rule, settings, (step) => {
      KC.hint.show({
        x: step.x,
        y: step.y,
        label: KC.hotkeys.stepLabel(rule.shortcut, step),
        opacity: settings.hintOpacity,
        durationMs: settings.hintDurationMs,
      });
    });
    if (!res.ok) {
      KC.hint.toast(res.reason || '触发失败', 'error');
      return;
    }
    if (res.interrupted) KC.hint.toast('已取消剩余点击', 'warn', 1800);
    for (const warning of res.warnings) KC.hint.toast(warning, 'warn');
  }

  async function onChange(event) {
    const select = event.target.closest('[data-scheme="select"]');
    if (select) {
      const name = select.value;
      if (name === KC.store.activeSchemeName(KC.origin)) return;
      let res = null;
      try {
        res = await KC.store.setActiveScheme(KC.origin, name);
      } catch (error) {
        KC.hint.toast(`切换方案失败：${(error && error.message) || error}`, 'error', 5000);
      }
      if (res && res.ok) {
        const count = KC.store.rulesFor(KC.origin).length;
        KC.hint.toast(`已切换到方案「${res.name}」，${count} 条快捷键`, 'ok', 2400);
      } else if (res) {
        KC.hint.toast(res.reason || '切换方案失败', 'error', 5000);
      }
      // 成功失败都要按存储里的真实状态重画：失败时下拉框必须弹回仍然生效的方案，
      // 不能停在一个没生效的选项上，否则看起来就像「切换没反应」。
      await render();
      return;
    }
    const interval = event.target.closest('[data-interval]');
    if (interval) {
      if (interval.value === '') return;
      const value = Number(interval.value);
      if (!Number.isFinite(value) || value < 0) return;
      KC.store.patchRule(KC.origin, interval.dataset.interval, {
        intervalMs: Math.min(10000, Math.round(value)),
      });
      return;
    }
    const gapInput = event.target.closest('[data-gap-rule]');
    if (gapInput) {
      const rule = KC.store.rulesFor(KC.origin).find((r) => r.id === gapInput.dataset.gapRule);
      const index = Number(gapInput.dataset.gapIndex);
      if (!rule || !rule.steps[index]) return;
      const raw = gapInput.value;
      const value = Number(raw);
      // 留空 = 取消这一步的单独设置，回到统一间隔
      const cleared = raw.trim() === '';
      if (!cleared && (!Number.isFinite(value) || value < 0)) return;
      const steps = rule.steps.map((step, i) => {
        if (i !== index) return step;
        const next = { ...step };
        if (cleared) delete next.gapMs;
        else next.gapMs = Math.min(10000, Math.round(value));
        return next;
      });
      KC.store.patchRule(KC.origin, rule.id, { steps });
      return;
    }
    const input = event.target.closest('[data-setting]');
    if (!input) return;
    const key = input.dataset.setting;
    const value =
      input.type === 'checkbox' ? input.checked : Number(input.value);
    if (input.type === 'number' && !Number.isFinite(value)) return;
    KC.store.updateSettings({ [key]: value });
  }

  function onInput(event) {
    const input = event.target.closest('[data-setting="hintOpacity"]');
    if (!input) return;
    const val = input.closest('.kc-field').querySelector('.kc-val');
    if (val) val.textContent = `${Math.round(Number(input.value) * 100)}%`;
  }

  function renderSchemes(profile) {
    const site = KC.store.siteOf(profile, KC.origin);
    const names = site ? Object.keys(site.schemes) : [KC.DEFAULT_SCHEME];
    const active = site ? site.activeScheme : KC.DEFAULT_SCHEME;

    refs.scheme.textContent = '';
    for (const name of names) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      option.selected = name === active;
      refs.scheme.appendChild(option);
    }
    // 逐个 append 时单选框会先把第一项选中，只靠 option.selected 可能停在错误的方案上
    refs.scheme.value = active;
    refs.schemeName.textContent = active;
    refs.schemeDelete.disabled = names.length <= 1;
  }

  function stepCoord(step) {
    if (!step) return '—';
    return Number.isFinite(step.nx) && Number.isFinite(step.ny)
      ? `${(step.nx * 100).toFixed(1)}%, ${(step.ny * 100).toFixed(1)}%`
      : `${Math.round(step.x)}, ${Math.round(step.y)}`;
  }

  function summaryOf(steps) {
    if (steps.length > 1) return `${steps.length} 个点`;
    return steps.length ? stepCoord(steps[0]) : '—';
  }

  function intervalRow(rule) {
    const row = document.createElement('label');
    row.className = 'kc-rule-interval';
    const caption = document.createElement('span');
    caption.textContent = '统一间隔';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '10000';
    input.step = '10';
    input.value = String(rule.intervalMs);
    input.dataset.interval = rule.id;
    input.title = '组内相邻两次点击的默认间隔；展开步骤后可为单步单独设置';
    const unit = document.createElement('span');
    unit.textContent = 'ms';
    row.append(caption, input, unit);
    return row;
  }

  // 展开后的逐步列表：每步可覆盖统一间隔，覆盖值就是「本步点击后到下一步点击前」的等待
  function stepsBox(rule) {
    const box = document.createElement('div');
    box.className = 'kc-steps';
    const steps = rule.steps;

    steps.forEach((step, index) => {
      const row = document.createElement('div');
      row.className = 'kc-step';

      const no = document.createElement('span');
      no.className = 'kc-step-no';
      no.textContent = String(index + 1);
      const coord = document.createElement('span');
      coord.className = 'kc-step-coord';
      coord.textContent = stepCoord(step);
      row.append(no, coord);

      if (index === steps.length - 1) {
        const tail = document.createElement('span');
        tail.className = 'kc-step-tail';
        tail.textContent = '最后一步';
        row.appendChild(tail);
        box.appendChild(row);
        return;
      }

      const own = Number(step.gapMs);
      const custom = Number.isFinite(own) && own >= 0;
      const caption = document.createElement('span');
      caption.textContent = '等待';
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '10000';
      input.step = '10';
      input.value = String(custom ? own : rule.intervalMs);
      input.dataset.gapRule = rule.id;
      input.dataset.gapIndex = String(index);
      input.title = '本步点击后到下一步点击前的等待；留空 = 跟随统一间隔';
      if (custom) input.dataset.custom = 'true';
      const unit = document.createElement('span');
      unit.textContent = 'ms';
      row.append(caption, input, unit);

      if (custom) {
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'kc-mini';
        reset.dataset.act = 'reset-gap';
        reset.dataset.id = rule.id;
        reset.dataset.index = String(index);
        reset.textContent = '重置';
        reset.title = '恢复为统一间隔';
        row.appendChild(reset);
      }

      box.appendChild(row);
    });

    return box;
  }

  function renderRules() {
    const rules = KC.store.rulesFor(KC.origin);
    refs.origin.textContent = KC.origin;
    refs.ruleCount.textContent = rules.length ? `（${rules.length} 条）` : '';
    refs.listToggle.hidden = !rules.length;
    refs.listToggle.textContent = listCollapsed ? `展开列表（${rules.length}）` : '收起列表';
    refs.rules.hidden = listCollapsed;
    refs.rules.textContent = '';
    if (listCollapsed) return;

    if (!rules.length) {
      const empty = document.createElement('div');
      empty.className = 'kc-empty';
      empty.textContent = '当前方案还没有绑定任何快捷键。';
      refs.rules.appendChild(empty);
      return;
    }

    // 最新录制的排在最上面。只是展示顺序倒过来，存储仍是添加顺序，组的播放顺序不受影响
    for (const rule of rules.slice().reverse()) {
      const steps = Array.isArray(rule.steps) ? rule.steps : [];
      const row = document.createElement('div');
      row.className = 'kc-rule';

      const top = document.createElement('div');
      top.className = 'kc-rule-top';
      const kbd = document.createElement('span');
      kbd.className = 'kc-kbd';
      kbd.textContent = KC.hotkeys.comboLabel(rule.shortcut);
      const name = document.createElement('span');
      name.className = 'kc-rule-name';
      name.textContent = rule.name || '未命名';
      const coord = document.createElement('span');
      coord.className = 'kc-rule-coord';
      coord.textContent = summaryOf(steps);
      top.append(kbd, name, coord);
      row.appendChild(top);

      const multi = steps.length > 1;
      if (multi) {
        row.appendChild(intervalRow(rule));
        if (expanded.has(rule.id)) row.appendChild(stepsBox(rule));
      }

      const actions = document.createElement('div');
      actions.className = 'kc-rule-actions';
      const acts = [
        ['test', '测试点击'],
        ['rename', '改名'],
        ['delete', '删除'],
      ];
      if (multi) {
        acts.push(['expand', expanded.has(rule.id) ? '收起步骤' : `展开步骤（${steps.length}）`]);
      }
      for (const [act, label] of acts) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'kc-mini';
        btn.dataset.act = act;
        btn.dataset.id = rule.id;
        btn.textContent = label;
        actions.appendChild(btn);
      }

      row.appendChild(actions);
      refs.rules.appendChild(row);
    }
  }

  function renderSettings(profile) {
    for (const input of root.querySelectorAll('[data-setting]')) {
      const key = input.dataset.setting;
      const value = profile.settings[key];
      if (input.type === 'checkbox') input.checked = !!value;
      else input.value = value;
      if (key === 'hintOpacity') {
        const val = input.closest('.kc-field').querySelector('.kc-val');
        if (val) val.textContent = `${Math.round(Number(value) * 100)}%`;
      }
    }
  }

  async function render() {
    const profile = await KC.store.load();
    renderSchemes(profile);
    renderRules();
    renderSettings(profile);
    refs.fab.dataset.state = profile.settings.enabled ? 'on' : 'off';
  }

  function setRecordStatus(text, kind) {
    if (!text) {
      refs.recordStatus.hidden = true;
      refs.recordStatus.textContent = '';
      return;
    }
    refs.recordStatus.hidden = false;
    refs.recordStatus.dataset.kind = kind || 'info';
    refs.recordStatus.textContent = text;
  }

  function importSlot() {
    return refs.importSlot;
  }

  function clearImportSlot() {
    if (refs) refs.importSlot.textContent = '';
  }

  KC.panel = {
    build,
    open,
    close,
    toggle,
    isOpen,
    render,
    setRecordStatus,
    importSlot,
    clearImportSlot,
  };

  KC.on(async (event) => {
    if (event !== 'profile') return;
    const profile = await KC.store.load();
    if (refs) refs.fab.dataset.state = profile.settings.enabled ? 'on' : 'off';
    if (KC.state.panelOpen) render();
  });
})();
