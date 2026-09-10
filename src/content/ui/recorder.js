(() => {
  const CK = self.COORDKEY;
  const t = (key, params) => CK.i18n.t(key, params);

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
      t('recorder.recorded', {
        count: points.length,
        lastInfo: last ? t('recorder.lastPoint', { coord: coordText(last) }) : '',
      }),
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
        canvas ? t('recorder.firstPointCanvas') : t('recorder.firstPointViewport'),
        'ok',
        4200,
      );
    }
  }

  function undoPoint() {
    if (!points.length) {
      CK.hint.toast(t('recorder.noPointsToUndo'), 'warn', 1600);
      return;
    }
    points.pop();
    CK.hint.setDraftPoints(points);
    if (!points.length) {
      phase = 'point';
      CK.panel.setRecordStatus(t('recorder.allUndone'));
      return;
    }
    statusForPoints();
    CK.hint.toast(t('recorder.undone', { n: points.length + 1 }), 'warn', 1600);
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
      const msg = t('recorder.clickFirst');
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
        const name = conflict.name || t('recorder.unnamed');
        if (!window.confirm(t('recorder.conflict', { combo: CK.hotkeys.comboLabel(combo), name }))) return;
        pending = { combo, overwriteId: conflict.id };
      } else {
        pending = { combo, overwriteId: null };
      }
      phase = 'selftest';
      CK.hint.setDraftPoints(points);
      const label = CK.hotkeys.comboLabel(combo);
      CK.panel.setRecordStatus(
        t('recorder.selfTestStatus', { count: points.length, label }),
      );
      CK.hint.toast(t('recorder.selfTestToast', { label }), 'ok', 2800);
      selfTestTimer = setTimeout(() => {
        const msg = t('recorder.selfTestTimeout', { label });
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
        : t('recorder.summaryMulti', { count: rule.steps.length, interval: rule.intervalMs });
    const scheme = CK.store.activeSchemeName(CK.origin);
    CK.panel.setRecordStatus(t('recorder.savedStatus', { scheme, label, summary }));
    CK.hint.toast(t('recorder.savedToast', { label, summary }));
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
      through ? t('recorder.startThrough') : t('recorder.startCapture'),
    );
    CK.hint.toast(
      through ? t('recorder.startThroughToast') : t('recorder.startCaptureToast'),
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
    CK.hint.toast(t('recorder.cancelled'), 'warn', 1800);
  }

  CK.recorder = { start, cancel, isActive: () => CK.state.recording };
})();
