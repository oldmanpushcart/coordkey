(() => {
  const CK = self.COORDKEY;
  const t = (key, params) => CK.i18n.t(key, params);

  // 坐标以主框架视口为基准，子框架内无法正确换算，直接退出
  if (window.top !== window.self) {
    setTimeout(
      () => CK.hint.toast(t('main.iframeNotSupported'), 'error', 8000),
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
      CK.hint.toast(res.reason || t('panel.triggerFail'), 'error');
      return;
    }
    if (res.paused) CK.hint.toast(t('panel.cancelled'), 'warn', 1800);
    else if (res.resumed) CK.hint.toast(t('panel.resumed'), 'ok', 1200);
    for (const warning of res.warnings) CK.hint.toast(warning, 'warn');
  }

  window.addEventListener(
    'keydown',
    (event) => {
      if (CK.state.recording) return; // 录制 / 自检由 recorder 处理
      if (event.key === 'Escape') {
        if (CK.state.panelOpen) {
          event.preventDefault();
          event.stopPropagation();
          CK.panel.close();
        }
        return;
      }
      if (CK.state.panelOpen) return; // 面板打开时挂起触发，避免误操作

      const profile = CK.store.current();
      const settings = profile && profile.settings;
      if (!settings || !settings.enabled) return;
      if (settings.skipInInput && isInEditable(event.target)) return;

      const site = CK.store.siteOf(profile, CK.origin);
      if (!site || !site.enabled) return;

      const rule = CK.store.findRule(CK.origin, event);
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
    if (document.visibilityState === 'hidden') CK.clicker.cancelAll();
  });

  (async function init() {
    await CK.store.load();
    const profile = CK.store.current();
    CK.i18n.init(profile && profile.settings && profile.settings.lang);
    // 数据来自更新版本的 CoordKey 时 store 转为只读，不明说用户会以为改动保存了
    const foreign = CK.store.foreignVersion();
    if (foreign) {
      CK.hint.toast(
        t('main.foreignVersion', { foreign, cur: CK.VERSION }),
        'error',
        12000,
      );
    }
    CK.panel.build();
    CK.markers.render();
  })();
})();
