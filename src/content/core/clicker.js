(() => {
  const KC = self.KEYCLICK;

  // ruleId -> run。同一条规则播放中再次触发即为取消，所以必须有这张运行表。
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
        warnings.push('页面上找不到 canvas，已使用录制时的原始坐标');
        return { x: step.x, y: step.y, canvas: null, warnings };
      }
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return { x: step.x, y: step.y, canvas, warnings: ['canvas 当前尺寸为 0，无法反算坐标'] };
    }

    // 录制时页面上没有 canvas 的点不带归一化坐标，直接退回原始像素
    if (!Number.isFinite(step.nx) || !Number.isFinite(step.ny)) {
      if (!Number.isFinite(step.x) || !Number.isFinite(step.y)) return null;
      return {
        x: step.x,
        y: step.y,
        canvas,
        warnings: ['规则缺少归一化坐标，已使用录制时的原始坐标'],
      };
    }

    const x = rect.left + step.nx * rect.width;
    const y = rect.top + step.ny * rect.height;

    if (env) {
      if (Math.abs(window.innerWidth - env.vw) > 2 || Math.abs(window.innerHeight - env.vh) > 2) {
        warnings.push(
          `窗口尺寸已变化（录制时 ${env.vw}×${env.vh}，当前 ${window.innerWidth}×${window.innerHeight}）`,
        );
      }
      if (env.dpr && Math.abs(window.devicePixelRatio - env.dpr) > 0.01) {
        warnings.push('屏幕缩放比例已变化');
      }
    }
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
      warnings.push('目标点在当前视口外，点击可能无效');
    }

    return { x, y, canvas, warnings };
  }

  // 抬起之后才 resolve，保证节奏确定：按下 → 按住 → 抬起 → 等间隔 → 下一点。
  // 否则间隔小于按住时长时，上一次还没抬手就会按下下一次。
  function syntheticClick(target, holdMs) {
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
      if (holdMs > 0) setTimeout(release, holdMs);
      else release();
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

  async function perform(rule, settings, onStep) {
    const steps = Array.isArray(rule.steps) ? rule.steps : [];
    if (!steps.length) {
      return { ok: false, reason: '规则没有任何点击步骤', warnings: [], steps: [], cancelled: false };
    }

    const holdMs = settings && Number(settings.holdMs) > 0 ? Number(settings.holdMs) : 0;
    const key = rule.id || KC.uid();
    const run = { cancelled: false, wake: null };
    runs.set(key, run);

    const warnings = [];
    const done = [];
    for (let i = 0; i < steps.length; i += 1) {
      if (run.cancelled) break;
      const target = resolveTarget(steps[i], rule.env);
      if (!target) {
        // 单点解析失败只跳过该点，不中断整组
        warnings.push(`第 ${i + 1} 个点无法解析坐标，已跳过`);
        continue;
      }
      for (const warning of target.warnings || []) {
        if (!warnings.includes(warning)) warnings.push(warning);
      }
      await syntheticClick(target, holdMs);
      done.push({ index: i, x: target.x, y: target.y });
      if (onStep) onStep({ index: i, total: steps.length, x: target.x, y: target.y });
      const wait = gapAfter(rule, steps[i]);
      if (wait && i < steps.length - 1) await sleep(wait, run);
    }

    // 取消之后用户可能立刻又按了一次，那时运行表里已经是新的一轮，不能误删
    if (runs.get(key) === run) runs.delete(key);

    return {
      ok: done.length > 0,
      cancelled: run.cancelled,
      reason: done.length ? '' : '没有成功点击任何位置',
      warnings,
      steps: done,
    };
  }

  // 对外唯一入口：播放中再次触发 = 取消剩余步骤
  async function trigger(rule, settings, onStep) {
    if (!rule) return { ok: false, reason: '规则不存在', warnings: [], steps: [] };
    const running = rule.id ? runs.get(rule.id) : null;
    if (running) {
      cancelRun(running);
      return { ok: true, cancelled: true, interrupted: true, warnings: [], steps: [] };
    }
    return perform(rule, settings, onStep);
  }

  function cancelAll() {
    for (const run of runs.values()) cancelRun(run);
    runs.clear();
  }

  KC.clicker = { trigger, cancelAll, resolveTarget, findCanvas, canvasAt, describeCanvas };
})();
