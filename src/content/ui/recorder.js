(() => {
  const CK = self.COORDKEY;

  // contextmenu 必须一起吞掉：右键用来撤销上一个点，否则每撤销一次就弹一次系统菜单
  const CAPTURE_EVENTS = ['pointerdown', 'mousedown', 'mouseup', 'click', 'contextmenu'];
  const SELFTEST_TIMEOUT_MS = 3000;

  let phase = 'idle'; // idle | point | combo | selftest
  let points = [];
  let pending = null;
  let selfTestTimer = null;

  function isOurUi(target) {
    return (
      (CK.widgetHost && (target === CK.widgetHost || CK.widgetHost.contains(target))) ||
      (CK.hintHost && (target === CK.hintHost || CK.hintHost.contains(target)))
    );
  }

  // 设置项「录制时点击照常生效」：逐事件读取，录制途中在面板里改也立刻生效
  function passthrough() {
    return CK.store.current().settings.recordPassthrough;
  }

  // 穿透开启时左键真实传给页面——多步骤流程往往要先操作页面切到别的界面，再点下一个位置；
  // 关闭时整条左键序列被吞掉，页面不会响应，这次点击只用来取坐标。
  // 只在 pointerdown 上记账：同一次点击还会派发 mousedown，两处都记会重复加点。
  // 右键是撤销手势，两种模式下都整条吞掉，免得页面把它当成一次右键操作或弹出系统菜单。
  function onPointerCapture(event) {
    if (isOurUi(event.target)) return;
    if (phase !== 'point' && phase !== 'combo') return;
    if (event.type === 'contextmenu' || event.button === 2) {
      event.preventDefault();
      event.stopPropagation();
      if (event.type === 'pointerdown') undoPoint();
      return;
    }
    if (event.button !== 0) return;
    if (!passthrough()) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (event.type === 'pointerdown') recordPoint(event);
  }

  function coordText(point) {
    return Number.isFinite(point.nx) && Number.isFinite(point.ny)
      ? `${(point.nx * 100).toFixed(1)}%, ${(point.ny * 100).toFixed(1)}%`
      : `${Math.round(point.x)}, ${Math.round(point.y)}`;
  }

  function statusForPoints() {
    const last = points[points.length - 1];
    CK.panel.setRecordStatus(
      `已记录 ${points.length} 个点${last ? `（最后一点 ${coordText(last)}）` : ''}，` +
        '继续点击可添加，右键撤销上一点；按下按键完成绑定，Escape 取消。',
    );
  }

  function recordPoint(event) {
    const canvas = CK.clicker.canvasAt(event.clientX, event.clientY);
    const point = {
      x: event.clientX,
      y: event.clientY,
      canvas: canvas ? CK.clicker.describeCanvas(canvas) : null,
      nx: null,
      ny: null,
    };
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width && rect.height) {
        point.nx = (event.clientX - rect.left) / rect.width;
        point.ny = (event.clientY - rect.top) / rect.height;
      }
    }
    points.push(point);
    const first = points.length === 1;
    phase = 'combo';
    CK.hint.setReticle(0, 0, false);
    CK.hint.setDraftPoints(points);
    statusForPoints();
    if (first) {
      CK.hint.toast(
        `第 1 个点已记录${canvas ? '（已锁定 canvas）' : '（按视口坐标记录）'}。` +
          '继续点击可连点成组，右键撤销上一点；按下按键完成绑定（Escape 取消）。',
        'ok',
        4200,
      );
    }
  }

  function undoPoint() {
    if (!points.length) {
      CK.hint.toast('还没有可撤销的点', 'warn', 1600);
      return;
    }
    points.pop();
    CK.hint.setDraftPoints(points);
    if (!points.length) {
      phase = 'point';
      CK.panel.setRecordStatus('已撤销全部点。点击要绑定的位置，然后按按键或组合键。');
      return;
    }
    statusForPoints();
    CK.hint.toast(`已撤销第 ${points.length + 1} 个点`, 'warn', 1600);
  }

  function onMove(event) {
    if (phase !== 'point' && phase !== 'combo') return;
    CK.hint.setReticle(
      event.clientX,
      event.clientY,
      true,
      `${Math.round(event.clientX)}, ${Math.round(event.clientY)}`,
    );
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    if (phase === 'point') {
      event.preventDefault();
      event.stopPropagation();
      if (!CK.hotkeys.comboFromEvent(event)) return; // 纯修饰键，可能只是先按住了 Shift
      const msg = '请先点击要绑定的位置';
      CK.panel.setRecordStatus(msg, 'error');
      CK.hint.toast(msg, 'error', 2600);
      return;
    }
    if (phase === 'combo') {
      event.preventDefault();
      event.stopPropagation();
      const combo = CK.hotkeys.comboFromEvent(event);
      if (!combo) return; // 纯修饰键，继续等
      const check = CK.hotkeys.validate(combo);
      if (!check.ok) {
        CK.panel.setRecordStatus(check.reason, 'error');
        CK.hint.toast(check.reason, 'error', 4200);
        return;
      }
      const conflict = CK.store
        .rulesFor(CK.origin)
        .find((r) => CK.hotkeys.comboId(r.shortcut) === check.id);
      if (conflict) {
        const name = conflict.name || '未命名';
        if (!window.confirm(`${CK.hotkeys.comboLabel(combo)} 已绑定到「${name}」，覆盖它？`)) return;
        pending = { combo, overwriteId: conflict.id };
      } else {
        pending = { combo, overwriteId: null };
      }
      phase = 'selftest';
      CK.hint.setDraftPoints(points);
      const label = CK.hotkeys.comboLabel(combo);
      CK.panel.setRecordStatus(
        `${points.length} 个点已就绪，自检中：请再按一次 ${label} 确认浏览器能送达（3 秒超时）。`,
      );
      CK.hint.toast(`自检：请再按一次 ${label}`, 'ok', 2800);
      selfTestTimer = setTimeout(() => {
        const msg = `3 秒内没有收到 ${label}。它可能被浏览器保留或被其他扩展占用，未保存。`;
        CK.panel.setRecordStatus(msg, 'error');
        CK.hint.toast(msg, 'error', 5000);
        finish();
      }, SELFTEST_TIMEOUT_MS);
      return;
    }
    if (phase === 'selftest') {
      event.preventDefault();
      event.stopPropagation();
      // 自检要的是真实的第二次按下，长按的自动重复不算
      if (event.repeat) return;
      if (!CK.hotkeys.matchesEvent({ shortcut: pending.combo }, event)) return;
      clearTimeout(selfTestTimer);
      save();
    }
  }

  async function save() {
    const { combo, overwriteId } = pending;
    const label = CK.hotkeys.comboLabel(combo);
    const rule = {
      id: overwriteId || CK.uid(),
      name: '',
      shortcut: { ...combo },
      steps: points.map((point) => ({
        nx: point.nx,
        ny: point.ny,
        x: point.x,
        y: point.y,
        canvas: point.canvas,
      })),
      intervalMs: CK.DEFAULT_STEP_INTERVAL_MS,
      env: {
        vw: window.innerWidth,
        vh: window.innerHeight,
        dpr: window.devicePixelRatio,
      },
      createdAt: new Date().toISOString(),
    };
    await CK.store.upsertRule(CK.origin, rule);
    const summary =
      rule.steps.length === 1
        ? coordText(rule.steps[0])
        : `${rule.steps.length} 个点，间隔 ${rule.intervalMs}ms`;
    const scheme = CK.store.activeSchemeName(CK.origin);
    CK.panel.setRecordStatus(`已保存到方案「${scheme}」：${label} → ${summary}`);
    CK.hint.toast(`已绑定 ${label} → ${summary}`, 'ok');
    finish();
  }

  function finish() {
    clearTimeout(selfTestTimer);
    selfTestTimer = null;
    for (const type of CAPTURE_EVENTS) {
      window.removeEventListener(type, onPointerCapture, true);
    }
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('keydown', onKey, true);
    CK.hint.setReticle(0, 0, false);
    CK.hint.setDraftPoints([]);
    phase = 'idle';
    points = [];
    pending = null;
    CK.state.recording = false;
  }

  function start() {
    if (CK.state.recording) return;
    CK.state.recording = true;
    phase = 'point';
    points = [];
    pending = null;

    const through = passthrough();
    // 关闭面板，把整个屏幕让给页面，避免面板挡住要绑定的位置
    CK.panel.close();
    CK.hint.setDraftPoints([]);
    CK.panel.setRecordStatus(
      through
        ? '录制中：依次点击要绑定的位置（点击照常生效，可先操作页面切到别的界面再点下一个），最后按按键或组合键。Escape 取消。'
        : '录制中：依次点击要绑定的位置（点击不会传给页面，只用来取坐标），最后按按键或组合键。Escape 取消。',
    );
    CK.hint.toast(
      through
        ? '录制中：依次点击要绑定的位置，点击会照常传给页面（可边操作边录）；连点多个即为顺序点击组，右键撤销上一点，最后按按键或组合键。Escape 取消。'
        : '录制中：依次点击要绑定的位置，点击不会传给页面，只用来取坐标；连点多个即为顺序点击组，右键撤销上一点，最后按按键或组合键。Escape 取消。',
      'ok',
      6000,
    );

    for (const type of CAPTURE_EVENTS) {
      window.addEventListener(type, onPointerCapture, true);
    }
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('keydown', onKey, true);
  }

  function cancel() {
    finish();
    CK.panel.setRecordStatus('');
    CK.hint.toast('已取消录制', 'warn', 1800);
  }

  CK.recorder = { start, cancel, isActive: () => CK.state.recording };
})();
