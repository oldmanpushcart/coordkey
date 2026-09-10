(() => {
  const CK = self.COORDKEY;
  const t = (key, params) => CK.i18n.t(key, params);

  // ruleId -> run。运行表用于快捷键的 播放→中断→恢复 状态切换。
  const runs = new Map();

  function allCanvases() {
    return Array.from(document.querySelectorAll('canvas'));
  }

  function findCanvas(hint) {
    const canvases = allCanvases();
    if (!canvases.length) return null;
    if (hint) {
      if (hint.id) {
        const byId = canvases.find((c) => c.id === hint.id);
        if (byId) return byId;
      }
      const byIndex = canvases[hint.index];
      if (byIndex) return byIndex;
    }
    // 退回面积最大的可见 canvas —— 把 UI 全画进画布的页面，主画布通常就是它
    let best = null;
    let bestArea = 0;
    for (const canvas of canvases) {
      const rect = canvas.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        best = canvas;
      }
    }
    return best;
  }

  function canvasAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el && el.tagName === 'CANVAS' ? el : null;
  }

  function describeCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    return {
      index: allCanvases().indexOf(canvas),
      id: canvas.id || '',
      cls: typeof canvas.className === 'string' ? canvas.className : '',
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    };
  }

  // 归一化坐标反算为当前视口像素。
  // getBoundingClientRect 本身是视口相对的，因此页面滚动会被自动抵消。
  function resolveTarget(step, env) {
    const warnings = [];

    // 录制时点击就没落在 canvas 上的点（普通网页全是这种）本来就只存了视口像素，
    // 直接用原始坐标即可——这是正常路径而非降级，不该每次触发都弹一次警告。
    if (!step.canvas && !Number.isFinite(step.nx)) {
      if (!Number.isFinite(step.x) || !Number.isFinite(step.y)) return null;
      return { x: step.x, y: step.y, canvas: null, warnings };
    }

    const canvas = findCanvas(step.canvas);

    if (!canvas) {
      if (Number.isFinite(step.x) && Number.isFinite(step.y)) {
        warnings.push(t('clicker.noCanvas'));
        return { x: step.x, y: step.y, canvas: null, warnings };
      }
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return { x: step.x, y: step.y, canvas, warnings: [t('clicker.canvasZero')] };
    }

    // 录制时页面上没有 canvas 的点不带归一化坐标，直接退回原始像素
    if (!Number.isFinite(step.nx) || !Number.isFinite(step.ny)) {
      if (!Number.isFinite(step.x) || !Number.isFinite(step.y)) return null;
      return {
        x: step.x,
        y: step.y,
        canvas,
        warnings: [t('clicker.noNormalized')],
      };
    }

    const x = rect.left + step.nx * rect.width;
    const y = rect.top + step.ny * rect.height;

    if (env) {
      if (Math.abs(window.innerWidth - env.vw) > 2 || Math.abs(window.innerHeight - env.vh) > 2) {
        warnings.push(
          t('clicker.windowResized', { ow: env.vw, oh: env.vh, nw: window.innerWidth, nh: window.innerHeight }),
        );
      }
      if (env.dpr && Math.abs(window.devicePixelRatio - env.dpr) > 0.01) {
        warnings.push(t('clicker.dprChanged'));
      }
    }
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
      warnings.push(t('clicker.outOfViewport'));
    }

    return { x, y, canvas, warnings };
  }

  // 抬起之后才 resolve，保证节奏确定：按下 → 按住 → 抬起 → 等间隔 → 下一点。
  // 否则间隔小于按住时长时，上一次还没抬手就会按下下一次。
  // 传入 run 时，按住等待可被取消打断，实现立即中断。
  function syntheticClick(target, holdMs, run) {
    const el =
      target.canvas || document.elementFromPoint(target.x, target.y) || document.documentElement;
    const common = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: target.x,
      clientY: target.y,
      screenX: target.x,
      screenY: target.y,
      button: 0,
      buttons: 1,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      detail: 1,
    };

    return new Promise((resolve) => {
      el.dispatchEvent(new PointerEvent('pointerover', common));
      el.dispatchEvent(new PointerEvent('pointerenter', { ...common, bubbles: false }));
      el.dispatchEvent(new PointerEvent('pointermove', common));
      el.dispatchEvent(new MouseEvent('mouseover', common));
      el.dispatchEvent(new MouseEvent('mousemove', common));
      el.dispatchEvent(new PointerEvent('pointerdown', common));
      el.dispatchEvent(new MouseEvent('mousedown', common));

      const release = () => {
        el.dispatchEvent(new PointerEvent('pointerup', { ...common, buttons: 0 }));
        el.dispatchEvent(new MouseEvent('mouseup', { ...common, buttons: 0 }));
        el.dispatchEvent(new MouseEvent('click', { ...common, buttons: 0 }));
        resolve();
      };
      if (holdMs > 0 && run) {
        if (run.cancelled) return release();
        const timer = setTimeout(finish, holdMs);
        function finish() {
          clearTimeout(timer);
          release();
        }
        run.wake = finish;
      } else if (holdMs > 0) {
        setTimeout(release, holdMs);
      } else {
        release();
      }
    });
  }

  // 可被取消打断的等待，避免取消后还要空等一个完整间隔
  function sleep(ms, run) {
    return new Promise((resolve) => {
      if (run.cancelled) return resolve();
      const timer = setTimeout(finish, ms);
      function finish() {
        clearTimeout(timer);
        run.wake = null;
        resolve();
      }
      run.wake = finish;
    });
  }

  function cancelRun(run) {
    run.cancelled = true;
    if (run.wake) run.wake();
  }
  // 本步点击后到下一步点击前的等待：步骤自带 gapMs 优先，否则回落到规则的统一间隔
  function gapAfter(rule, step) {
    const own = Number(step.gapMs);
    const value = Number.isFinite(own) && own >= 0 ? own : Number(rule.intervalMs);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  // 轮间等待：可被取消打断，避免暂停后要空等一个完整间隔
  function gapSleep(ms, run) {
    return new Promise((resolve) => {
      if (run.cancelled) return resolve();
      const timer = setTimeout(finish, ms);
      function finish() {
        clearTimeout(timer);
        run.wake = null;
        resolve();
      }
      run.wake = finish;
    });
  }

  async function perform(rule, settings, onStep, totalRounds, remaining) {
    const steps = Array.isArray(rule.steps) ? rule.steps : [];
    if (!steps.length) {
      return { ok: false, reason: t('clicker.noSteps'), warnings: [], steps: [], cancelled: false };
    }

    const holdMs = settings && Number(settings.holdMs) > 0 ? Number(settings.holdMs) : 0;
    const key = rule.id || CK.uid();
    const run = { cancelled: false, wake: null, paused: false, totalRounds, remaining };
    runs.set(key, run);

    const warnings = [];
    const allDone = [];
    const intervalMs = Number(rule.repeatIntervalMs);
    const roundGap = Number.isFinite(intervalMs) && intervalMs >= 0
      ? intervalMs
      : 1000;

    for (let round = 0; round < remaining; round++) {
      if (run.cancelled) break;
      run.remaining = remaining - round;

      for (let i = 0; i < steps.length; i++) {
        if (run.cancelled) break;
        const target = resolveTarget(steps[i], rule.env);
        if (!target) {
          warnings.push(t('clicker.stepParseFail', { n: i + 1 }));
          continue;
        }
        for (const warning of target.warnings || []) {
          if (!warnings.includes(warning)) warnings.push(warning);
        }
        await syntheticClick(target, holdMs, run);
        allDone.push({ index: i, x: target.x, y: target.y });
        if (onStep) onStep({ index: i, total: steps.length, x: target.x, y: target.y, round: round + 1, totalRounds });
        const wait = gapAfter(rule, steps[i]);
        if (wait && i < steps.length - 1) await sleep(wait, run);
      }

      if (run.cancelled || run.paused) break;
      if (round < remaining - 1) await gapSleep(roundGap, run);
    }

    // 暂停时保留运行表条目，等恢复或取消时再清理；正常结束和纯取消都直接删
    if (!run.paused && runs.get(key) === run) runs.delete(key);

    return {
      ok: allDone.length > 0,
      cancelled: run.cancelled,
      paused: run.paused,
      reason: allDone.length ? '' : t('clicker.noClickSuccess'),
      warnings,
      steps: allDone,
    };
  }

  // 立即中断：设置取消标志并唤醒所有等待，当前步骤的按下→抬起完成后即退出循环
  function pauseRun(run) {
    run.paused = true;
    run.cancelled = true;
    if (run.wake) run.wake();
  }

  // 恢复：从第一步开始，剩余次数继续
  async function resumeRun(rule, settings, onStep, run) {
    const remaining = run.remaining || 1;
    const total = run.totalRounds || 1;
    return perform(rule, settings, onStep, total, remaining);
  }

  // 对外唯一入口：
  // - 未运行 → 开始播放（含重复轮次）
  // - 运行中未暂停 → 立即中断（当前步骤完成后停止）
  // - 已暂停 → 恢复（从第一步开始，剩余次数继续）
  async function trigger(rule, settings, onStep) {
    if (!rule) return { ok: false, reason: t('clicker.ruleNotFound'), warnings: [], steps: [] };
    const running = rule.id ? runs.get(rule.id) : null;
    if (running) {
      if (running.paused) {
        resumeRun(rule, settings, onStep, running);
        return { ok: true, resumed: true, warnings: [], steps: [] };
      }
      pauseRun(running);
      return { ok: true, paused: true, warnings: [], steps: [] };
    }
    const raw = Number(rule.repeatCount);
    const totalRounds = Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 1;
    if (totalRounds <= 0) return { ok: false, reason: t('clicker.zeroCount'), warnings: [], steps: [] };
    return perform(rule, settings, onStep, totalRounds, totalRounds);
  }

  function getState(ruleId) {
    if (!ruleId) return null;
    const run = runs.get(ruleId);
    if (!run) return null;
    return {
      paused: !!run.paused,
      totalRounds: run.totalRounds || 1,
      remaining: run.remaining || 0,
    };
  }

  function activeState() {
    for (const [id, run] of runs) {
      return { ruleId: id, paused: !!run.paused, totalRounds: run.totalRounds || 1, remaining: run.remaining || 0 };
    }
    return null;
  }

  function cancelAll() {
    for (const run of runs.values()) cancelRun(run);
    runs.clear();
  }

  CK.clicker = { trigger, cancelAll, getState, activeState, resolveTarget, findCanvas, canvasAt, describeCanvas };
})();
