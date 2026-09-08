(() => {
  const KC = self.KEYCLICK;

  // 坐标以主框架视口为基准，子框架内无法正确换算，直接退出
  if (window.top !== window.self) {
    setTimeout(
      () => KC.hint.toast('KeyClick 暂不支持在 iframe 内运行：请直接在顶层标签页打开目标页面。', 'error', 8000),
      1500,
    );
    return;
  }

  function isInEditable(target) {
    const el = target instanceof Element ? target : null;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  async function trigger(rule, settings) {
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

  window.addEventListener(
    'keydown',
    (event) => {
      if (KC.state.recording) return; // 录制 / 自检由 recorder 处理
      if (event.key === 'Escape') {
        if (KC.state.panelOpen) {
          event.preventDefault();
          event.stopPropagation();
          KC.panel.close();
        }
        return;
      }
      if (KC.state.panelOpen) return; // 面板打开时挂起触发，避免误操作

      const profile = KC.store.current();
      const settings = profile && profile.settings;
      if (!settings || !settings.enabled) return;
      if (settings.skipInInput && isInEditable(event.target)) return;

      const site = KC.store.siteOf(profile, KC.origin);
      if (!site || !site.enabled) return;

      const rule = KC.store.findRule(KC.origin, event);
      if (!rule) return;

      event.preventDefault();
      event.stopPropagation();
      // 长按的自动重复不算「再按一次」，否则组会被自己立刻取消
      if (event.repeat) return;
      trigger(rule, settings);
    },
    true,
  );

  // 页面切到后台时停掉正在播放的组，别在看不见的页面上继续连点
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') KC.clicker.cancelAll();
  });

  (async function init() {
    await KC.store.load();
    KC.panel.build();
    KC.markers.render();
  })();
})();
