(() => {
  const CK = self.COORDKEY;

  let layer = null;
  let items = [];
  let frame = 0;
  let bound = false;

  // 复用浮现层的 shadow host：它本身就是 pointer-events:none，标记不会吞掉页面点击。
  // 插在 .ck-hint-root 之前，触发时的闪现反馈才会盖在同位置的持久标记之上。
  function ensureLayer() {
    const root = CK.hint.ensure();
    if (layer && layer.isConnected) return layer;
    layer = document.createElement('div');
    layer.className = 'ck-markers';
    root.insertBefore(layer, root.querySelector('.ck-hint-root'));
    return layer;
  }

  function position() {
    for (const item of items) {
      const target = CK.clicker.resolveTarget(item.step, item.rule.env);
      if (!target) {
        item.el.style.display = 'none';
        continue;
      }
      item.el.style.display = '';
      item.el.style.left = `${target.x}px`;
      item.el.style.top = `${target.y}px`;
    }
  }

  // 归一化坐标依赖 canvas 的实时位置，视口变化后要重算
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      position();
    });
  }

  function bindViewport() {
    if (bound) return;
    bound = true;
    window.addEventListener('resize', schedule, true);
    window.addEventListener('scroll', schedule, true);
  }

  function render() {
    const box = ensureLayer();
    box.textContent = '';
    items = [];
    bindViewport();

    const profile = CK.store.current();
    if (!profile) return;
    const settings = profile.settings;
    const site = CK.store.siteOf(profile, CK.origin);
    if (!settings.showMarkers || !settings.enabled || !site || !site.enabled) return;

    const scheme = CK.store.activeSchemeOf(profile, CK.origin);
    for (const rule of scheme ? scheme.rules : []) {
      if (!rule.shortcut) continue;
      const steps = Array.isArray(rule.steps) ? rule.steps : [];
      if (!steps.length) continue;
      const symbols = CK.hotkeys.comboSymbols(rule.shortcut);
      steps.forEach((step, index) => {
        const el = document.createElement('div');
        el.className = 'ck-badge';
        // 多步规则带上序号，既能看出快捷键也能看出点击顺序
        el.textContent = steps.length > 1 ? `${index + 1} ${symbols}` : symbols;
        box.appendChild(el);
        items.push({ rule, step, el });
      });
    }
    position();
  }

  function clear() {
    if (layer) layer.textContent = '';
    items = [];
  }

  CK.on((event) => {
    if (event === 'profile') render();
  });

  CK.markers = { render, clear };
})();
