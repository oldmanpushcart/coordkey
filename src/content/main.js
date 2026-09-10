(() => {
  const CK = self.COORDKEY;

  // 坐标以主框架视口为基准，子框架内无法正确换算，直接退出
  if (window.top !== window.self) {
    setTimeout(
      () => CK.hint.toast('CoordKey 暂不支持在 iframe 内运行：请直接在顶层标签页打开目标页面。', 'error', 8000),
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
      CK.hint.toast(res.reason || '触发失败', 'error');
      return;
    }
    if (res.paused) CK.hint.toast('已中断', 'warn', 1800);
    else if (res.resumed) CK.hint.toast('已恢复执行', 'ok', 1200);
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
    // 数据来自更新版本的 CoordKey 时 store 转为只读，不明说用户会以为改动保存了
    const foreign = CK.store.foreignVersion();
    if (foreign) {
      CK.hint.toast(
        `当前配置由更新版本的 CoordKey 写入（配置 v${foreign}，本版本最高支持 v${CK.VERSION}）。` +
          '为避免写坏看不懂的数据，本次会话的改动不会保存；扩展图标上的总开关仍然可用。',
        'error',
        12000,
      );
    }
    CK.panel.build();
    CK.markers.render();
  })();
})();
