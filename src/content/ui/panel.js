(() => {
  const CK = self.COORDKEY;

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
  // 重复设置默认收起，需要时再展开
  const repeatExpanded = new Set();
  // 整个规则列表的收起状态同样要跨重渲染保留：切方案、改间隔都会触发重画
  let listCollapsed = false;

  function build() {
    if (root) return;
    host = document.createElement('div');
    host.setAttribute('data-coordkey-widget', '');
    // 宿主不铺满全屏且自身不接收指针事件，否则会挡住整个页面画布
    host.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:2147483647;pointer-events:none;';
    root = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = CK.styles.WIDGET_CSS;
    root.appendChild(style);

    const box = document.createElement('div');
    box.className = 'ck-root';
    box.innerHTML = `
      <button class="ck-fab" type="button" title="CoordKey" data-state="on">${FAB_SVG}<span class="ck-fab-badge"></span></button>
      <div class="ck-panel" data-open="false">
        <div class="ck-head">
          <span class="ck-title">CoordKey</span>
          <span class="ck-ver"></span>
          <button class="ck-iconbtn" type="button" data-act="close" title="关闭">×</button>
        </div>

        <div class="ck-section">
          <button class="ck-btn ck-btn-primary" type="button" data-act="record">＋ 录制快捷键（连点多个位置即为顺序点击组）</button>
          <div class="ck-record-status" hidden></div>
        </div>

        <div class="ck-section">
          <div class="ck-sec-title">方案</div>
          <div class="ck-scheme-row">
            <select class="ck-select" data-scheme="select" title="切换方案"></select>
            <button class="ck-iconbtn" type="button" data-act="scheme-new" title="新建空方案（快捷键需重新录制）">新建</button>
            <button class="ck-iconbtn" type="button" data-act="scheme-rename" title="重命名当前方案">改名</button>
            <button class="ck-iconbtn" type="button" data-act="scheme-delete" title="删除当前方案">删除</button>
          </div>
          <div class="ck-scheme-hint">窗口尺寸或布局不同时切换方案，各方案的快捷键互不干扰；新建的方案是空的，需要重新录制。</div>
        </div>

        <div class="ck-section">
          <div class="ck-sec-title ck-sec-head">
            <span>方案「<span class="ck-scheme-name"></span>」的规则<span class="ck-rule-count"></span> · <span class="ck-origin"></span></span>
            <button class="ck-mini" type="button" data-act="toggle-list" title="收起 / 展开快捷键列表，收起后不用滚动就能看到下面的设置"></button>
          </div>
          <div class="ck-rules"></div>
        </div>

        <div class="ck-section ck-row2">
          <button class="ck-btn" type="button" data-act="export">导出设置</button>
          <button class="ck-btn" type="button" data-act="import">导入设置</button>
        </div>
        <div class="ck-import-slot"></div>

        <div class="ck-section">
          <div class="ck-sec-title">设置</div>
          <label class="ck-switch-row"><input type="checkbox" data-setting="enabled"><span>总开关</span></label>
          <label class="ck-switch-row"><input type="checkbox" data-setting="skipInInput"><span>输入框内不触发</span></label>
          <label class="ck-switch-row" title="勾选：录制时的点击会真实传给页面，可以先操作页面切到别的界面再点下一个位置。取消：点击被扩展吞掉，页面不会响应，只用来取坐标。"><input type="checkbox" data-setting="recordPassthrough"><span>录制时点击照常生效</span></label>
          <label class="ck-switch-row"><input type="checkbox" data-setting="showMarkers"><span>显示坐标标记浮层</span></label>
          <label class="ck-field"><span>按住时长</span><span><input type="number" data-setting="holdMs" min="0" max="2000" step="10"> ms</span></label>
          <label class="ck-field"><span>浮现透明度</span><span><input type="range" data-setting="hintOpacity" min="0.05" max="1" step="0.05"><span class="ck-val"></span></span></label>
          <label class="ck-field"><span>浮现时长</span><span><input type="number" data-setting="hintDurationMs" min="200" max="5000" step="100"> ms</span></label>
        </div>
      </div>`;
    root.appendChild(box);
    document.documentElement.appendChild(host);
    CK.widgetHost = host;

    refs = {
      fab: box.querySelector('.ck-fab'),
      fabBadge: box.querySelector('.ck-fab-badge'),
      panel: box.querySelector('.ck-panel'),
      recordStatus: box.querySelector('.ck-record-status'),
      rules: box.querySelector('.ck-rules'),
      ruleCount: box.querySelector('.ck-rule-count'),
      listToggle: box.querySelector('[data-act="toggle-list"]'),
      origin: box.querySelector('.ck-origin'),
      scheme: box.querySelector('[data-scheme="select"]'),
      schemeName: box.querySelector('.ck-scheme-name'),
      schemeDelete: box.querySelector('[data-act="scheme-delete"]'),
      importSlot: box.querySelector('.ck-import-slot'),
      version: box.querySelector('.ck-ver'),
    };

    // 版本号的唯一事实来源是 manifest，模板里不写死，免得两处对不上
    refs.version.textContent = CK.APP_VERSION ? `v${CK.APP_VERSION}` : '';

    box.addEventListener('click', onClick);
    box.addEventListener('change', onChange);
    box.addEventListener('input', onInput);
    refs.fab.addEventListener('click', () => {
      const state = CK.clicker.activeState();
      if (state && !state.paused) {
        CK.clicker.cancelAll();
        CK.hint.toast('已中断', 'warn', 1800);
        return;
      }
      toggle();
    });

    // 每 200ms 刷新 FAB 角标：显示正在执行的轮次进度
    setInterval(tick, 200);

    // 点击面板外区域收起。Shadow 内容的事件在 document 层会被重定向到宿主，
    // 因此 contains(host) 即可覆盖「点在面板内」的情况。
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (!CK.state.panelOpen) return;
        if (host.contains(event.target)) return;
        close();
      },
      true,
    );
  }

  function isOpen() {
    return CK.state.panelOpen;
  }

  function open() {
    build();
    CK.state.panelOpen = true;
    refs.panel.dataset.open = 'true';
    render();
  }

  function close() {
    if (!CK.state.panelOpen) return;
    CK.state.panelOpen = false;
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
    if (act === 'record') return CK.recorder.start();
    if (act === 'export') return CK.transfer.exportAll();
    if (act === 'import') return CK.transfer.promptImport();
    if (act.startsWith('scheme-')) return onSchemeAction(act);

    if (act === 'toggle-list') {
      listCollapsed = !listCollapsed;
      renderRules();
      return;
    }

    if (act === 'toggle-steps') {
      const target = btn.dataset.id;
      if (expanded.has(target)) expanded.delete(target);
      else expanded.add(target);
      renderRules();
      return;
    }

    if (act === 'toggle-repeat') {
      const target = btn.dataset.id;
      if (repeatExpanded.has(target)) repeatExpanded.delete(target);
      else repeatExpanded.add(target);
      renderRules();
      return;
    }

    const id = btn.dataset.id;
    const rule = CK.store.rulesFor(CK.origin).find((r) => r.id === id);
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
      CK.store.patchRule(CK.origin, id, { steps });
      return;
    }

    if (act === 'test') return performTest(rule);
    if (act === 'rename') {
      const name = window.prompt('规则名称', rule.name || '');
      if (name != null && name.trim()) CK.store.patchRule(CK.origin, id, { name: name.trim() });
      return;
    }
    if (act === 'delete') {
      if (window.confirm(`删除快捷键「${CK.hotkeys.comboLabel(rule.shortcut)}」？`)) {
        CK.store.removeRule(CK.origin, id);
      }
    }
  }

  async function onSchemeAction(act) {
    if (act === 'scheme-new') {
      const suggested = `方案 ${CK.store.schemesFor(CK.origin).length + 1}`;
      const name = window.prompt('新方案名称（新方案是空的，快捷键需要重新录制）', suggested);
      if (name == null) return;
      const res = await CK.store.createScheme(CK.origin, name.trim());
      if (res.ok) CK.hint.toast(`已创建并切换到方案「${res.name}」，还没有快捷键，点上方按钮开始录制`, 'ok', 3000);
      return;
    }

    const active = CK.store.activeScheme(CK.origin);
    if (!active) return;

    if (act === 'scheme-rename') {
      const name = window.prompt('重命名方案', active.name);
      if (name == null) return;
      const res = await CK.store.renameScheme(CK.origin, active.id, name);
      if (!res.ok) CK.hint.toast(res.reason, 'error');
      return;
    }

    if (act === 'scheme-delete') {
      const count = CK.store.rulesFor(CK.origin).length;
      const detail = count ? `其中的 ${count} 条快捷键会一并删除。` : '';
      if (!window.confirm(`删除方案「${active.name}」？${detail}`)) return;
      const res = await CK.store.deleteScheme(CK.origin, active.id);
      if (res.ok) CK.hint.toast(`已删除方案「${active.name}」`, 'ok');
      else CK.hint.toast(res.reason, 'error');
    }
  }

  async function performTest(rule) {
    const settings = CK.store.current().settings;
    const res = await CK.clicker.trigger(rule, settings, (step) => {
      CK.hint.show({
        x: step.x,
        y: step.y,
        label: CK.hotkeys.stepLabel(rule.shortcut, step),
        opacity: settings.hintOpacity,
        durationMs: settings.hintDurationMs,
      });
    });
    if (!res.ok) {
      CK.hint.toast(res.reason || '触发失败', 'error');
      return;
    }
    if (res.paused) CK.hint.toast('已中断', 'warn', 1800);
    else if (res.resumed) CK.hint.toast('已恢复执行', 'ok', 1200);
    for (const warning of res.warnings) CK.hint.toast(warning, 'warn');
  }

  async function onChange(event) {
    const select = event.target.closest('[data-scheme="select"]');
    if (select) {
      const id = select.value;
      const active = CK.store.activeScheme(CK.origin);
      if (active && id === active.id) return;
      let res = null;
      try {
        res = await CK.store.setActiveScheme(CK.origin, id);
      } catch (error) {
        CK.hint.toast(`切换方案失败：${(error && error.message) || error}`, 'error', 5000);
      }
      if (res && res.ok) {
        const count = CK.store.rulesFor(CK.origin).length;
        CK.hint.toast(`已切换到方案「${res.name}」，${count} 条快捷键`, 'ok', 2400);
      } else if (res) {
        CK.hint.toast(res.reason || '切换方案失败', 'error', 5000);
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
      CK.store.patchRule(CK.origin, interval.dataset.interval, {
        intervalMs: Math.min(10000, Math.round(value)),
      });
      return;
    }
    const gapInput = event.target.closest('[data-gap-rule]');
    if (gapInput) {
      const rule = CK.store.rulesFor(CK.origin).find((r) => r.id === gapInput.dataset.gapRule);
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
      CK.store.patchRule(CK.origin, rule.id, { steps });
      return;
    }
    const repeatCountInput = event.target.closest('[data-repeat-count]');
    if (repeatCountInput) {
      const value = Number(repeatCountInput.value);
      if (!Number.isFinite(value) || value < 0) return;
      CK.store.patchRule(CK.origin, repeatCountInput.dataset.repeatCount, {
        repeatCount: Math.min(999, Math.floor(value)),
      });
      return;
    }
    const repeatIntervalInput = event.target.closest('[data-repeat-interval]');
    if (repeatIntervalInput) {
      const raw = repeatIntervalInput.value;
      const cleared = raw.trim() === '';
      if (!cleared) {
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0) return;
        CK.store.patchRule(CK.origin, repeatIntervalInput.dataset.repeatInterval, {
          repeatIntervalMs: Math.min(60000, Math.round(value)),
        });
      } else {
        CK.store.patchRule(CK.origin, repeatIntervalInput.dataset.repeatInterval, {
          repeatIntervalMs: null,
        });
      }
      return;
    }
    const input = event.target.closest('[data-setting]');
    if (!input) return;
    const key = input.dataset.setting;
    const value =
      input.type === 'checkbox' ? input.checked : Number(input.value);
    if (input.type === 'number' && !Number.isFinite(value)) return;
    CK.store.updateSettings({ [key]: value });
  }

  function onInput(event) {
    const input = event.target.closest('[data-setting="hintOpacity"]');
    if (!input) return;
    const val = input.closest('.ck-field').querySelector('.ck-val');
    if (val) val.textContent = `${Math.round(Number(input.value) * 100)}%`;
  }

  function renderSchemes(profile) {
    const site = CK.store.siteOf(profile, CK.origin);
    const schemes = site ? site.schemes : [];
    // value 是 id、显示的是名字：id 才是身份，改了名字下拉框与存储的对应关系不会断
    const active = CK.store.activeSchemeOf(profile, CK.origin);

    refs.scheme.textContent = '';
    for (const scheme of schemes) {
      const option = document.createElement('option');
      option.value = scheme.id;
      option.textContent = scheme.name;
      option.selected = !!active && scheme.id === active.id;
      refs.scheme.appendChild(option);
    }
    // 逐个 append 时单选框会先把第一项选中，只靠 option.selected 可能停在错误的方案上
    if (active) refs.scheme.value = active.id;
    refs.schemeName.textContent = active ? active.name : CK.DEFAULT_SCHEME;
    refs.schemeDelete.disabled = schemes.length <= 1;
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
    row.className = 'ck-rule-interval';
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

  // 重复设置的输入区：展开后显示在重复按钮下方
  function repeatInputs(rule) {
    const wrap = document.createElement('div');
    wrap.className = 'ck-repeat-inputs';

    const countLabel = document.createElement('span');
    countLabel.textContent = '次数';
    const countInput = document.createElement('input');
    countInput.type = 'number';
    countInput.min = '1';
    countInput.max = '999';
    countInput.step = '1';
    countInput.value = String(rule.repeatCount ?? 1);
    countInput.dataset.repeatCount = rule.id;
    countInput.title = '总共执行几轮（1 = 只播一次）';
    const countUnit = document.createElement('span');
    countUnit.textContent = '次';

    const sep = document.createElement('span');
    sep.className = 'ck-repeat-sep';

    const gapLabel = document.createElement('span');
    gapLabel.textContent = '间隔';
    const gapInput = document.createElement('input');
    gapInput.type = 'number';
    gapInput.min = '0';
    gapInput.max = '60000';
    gapInput.step = '100';
    gapInput.placeholder = '1000';
    gapInput.dataset.repeatInterval = rule.id;
    gapInput.title = '每轮之间的等待；留空 = 1000ms';
    if (rule.repeatIntervalMs != null) gapInput.value = String(rule.repeatIntervalMs);
    const gapUnit = document.createElement('span');
    gapUnit.textContent = 'ms';

    wrap.append(countLabel, countInput, countUnit, sep, gapLabel, gapInput, gapUnit);
    return wrap;
  }

  function stepsBox(rule) {
    const box = document.createElement('div');
    box.className = 'ck-steps';
    const steps = rule.steps;

    steps.forEach((step, index) => {
      const row = document.createElement('div');
      row.className = 'ck-step';

      const no = document.createElement('span');
      no.className = 'ck-step-no';
      no.textContent = String(index + 1);
      const coord = document.createElement('span');
      coord.className = 'ck-step-coord';
      coord.textContent = stepCoord(step);
      row.append(no, coord);

      if (index === steps.length - 1) {
        const tail = document.createElement('span');
        tail.className = 'ck-step-tail';
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
        reset.className = 'ck-mini';
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
    const rules = CK.store.rulesFor(CK.origin);
    refs.origin.textContent = CK.origin;
    refs.ruleCount.textContent = rules.length ? `（${rules.length} 条）` : '';
    // 收起状态跨方案保留，而新建的方案是空的：空方案也要留着「展开列表」按钮，否则回不到列表
    refs.listToggle.hidden = !rules.length && !listCollapsed;
    refs.listToggle.textContent = listCollapsed
      ? `展开列表${rules.length ? `（${rules.length}）` : ''}`
      : '收起列表';
    refs.rules.hidden = listCollapsed;
    refs.rules.textContent = '';
    if (listCollapsed) return;

    if (!rules.length) {
      const empty = document.createElement('div');
      empty.className = 'ck-empty';
      empty.textContent = '当前方案还没有绑定任何快捷键，点上方「录制快捷键」开始录入。';
      refs.rules.appendChild(empty);
      return;
    }

    // 最新录制的排在最上面。只是展示顺序倒过来，存储仍是添加顺序，组的播放顺序不受影响
    for (const rule of rules.slice().reverse()) {
      const steps = Array.isArray(rule.steps) ? rule.steps : [];
      const row = document.createElement('div');
      row.className = 'ck-rule';

      const top = document.createElement('div');
      top.className = 'ck-rule-top';
      const kbd = document.createElement('span');
      kbd.className = 'ck-kbd';
      kbd.textContent = CK.hotkeys.comboLabel(rule.shortcut);
      const name = document.createElement('span');
      name.className = 'ck-rule-name';
      name.textContent = rule.name || '未命名';
      const coord = document.createElement('span');
      coord.className = 'ck-rule-coord';
      coord.textContent = summaryOf(steps);
      top.append(kbd, name, coord);
      row.appendChild(top);

      const multi = steps.length > 1;
      if (multi) {
        row.appendChild(intervalRow(rule));
      }

      const actions = document.createElement('div');
      actions.className = 'ck-rule-actions';

      const testBtn = document.createElement('button');
      testBtn.type = 'button';
      testBtn.className = 'ck-mini';
      testBtn.dataset.act = 'test';
      testBtn.dataset.id = rule.id;
      testBtn.textContent = '测试';
      actions.appendChild(testBtn);

      if (multi) {
        const stepsToggle = document.createElement('button');
        stepsToggle.type = 'button';
        stepsToggle.className = 'ck-mini ck-section-toggle';
        stepsToggle.dataset.act = 'toggle-steps';
        stepsToggle.dataset.id = rule.id;
        stepsToggle.textContent = `步骤 ${steps.length} ${expanded.has(rule.id) ? '▾' : '▸'}`;
        actions.appendChild(stepsToggle);
      }

      const repeatToggle = document.createElement('button');
      repeatToggle.type = 'button';
      repeatToggle.className = 'ck-mini ck-section-toggle';
      repeatToggle.dataset.act = 'toggle-repeat';
      repeatToggle.dataset.id = rule.id;
      const rc = rule.repeatCount ?? 1;
      const rArrow = repeatExpanded.has(rule.id) ? '▾' : '▸';
      repeatToggle.textContent = `次数 ${rc} ${rArrow}`;
      actions.appendChild(repeatToggle);

      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'ck-mini';
      renameBtn.dataset.act = 'rename';
      renameBtn.dataset.id = rule.id;
      renameBtn.textContent = '改名';
      actions.appendChild(renameBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'ck-mini';
      deleteBtn.dataset.act = 'delete';
      deleteBtn.dataset.id = rule.id;
      deleteBtn.textContent = '删除';
      actions.appendChild(deleteBtn);

      row.appendChild(actions);

      if (multi && expanded.has(rule.id)) row.appendChild(stepsBox(rule));
      if (repeatExpanded.has(rule.id)) row.appendChild(repeatInputs(rule));

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
        const val = input.closest('.ck-field').querySelector('.ck-val');
        if (val) val.textContent = `${Math.round(Number(value) * 100)}%`;
      }
    }
  }

  async function render() {
    const profile = await CK.store.load();
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

  function tick() {
    if (!refs) return;
    const state = CK.clicker.activeState();
    if (state) {
      const done = state.totalRounds - state.remaining;
      refs.fabBadge.textContent = `${done + (state.paused ? 0 : 1)}/${state.totalRounds}`;
      refs.fabBadge.dataset.visible = 'true';
      refs.fab.dataset.running = 'true';
      refs.fab.dataset.paused = state.paused ? 'true' : 'false';
    } else {
      refs.fabBadge.dataset.visible = 'false';
      delete refs.fab.dataset.running;
      delete refs.fab.dataset.paused;
    }
  }

  CK.panel = {
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

  CK.on(async (event) => {
    if (event !== 'profile') return;
    const profile = await CK.store.load();
    if (refs) refs.fab.dataset.state = profile.settings.enabled ? 'on' : 'off';
    if (CK.state.panelOpen) render();
  });
})();
