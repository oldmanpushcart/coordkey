(() => {
  const KC = self.KEYCLICK;

  let host = null;
  let root = null;

  function ensure() {
    if (root) return root;
    host = document.createElement('div');
    host.setAttribute('data-keyclick-hint', '');
    // 宿主本身必须 pointer-events:none，否则透明浮现层会吞掉页面的点击。
    // z-index 比交互面板低一级，保证面板始终浮在标记与浮现层之上。
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
    root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = KC.styles.HINT_CSS;
    root.appendChild(style);
    const container = document.createElement('div');
    container.className = 'kc-hint-root';
    root.appendChild(container);
    document.documentElement.appendChild(host);
    KC.hintHost = host;
    return root;
  }

  function container() {
    return ensure().querySelector('.kc-hint-root');
  }

  // 触发反馈：快捷键标签 + 扩散圆环，整体按设置的不透明度显示
  function show({ x, y, label, opacity = 0.3, durationMs = 900 }) {
    const box = container();
    const hint = document.createElement('div');
    hint.className = 'kc-hint';
    hint.style.left = `${x}px`;
    hint.style.top = `${y}px`;
    hint.style.opacity = String(opacity);

    const ring = document.createElement('div');
    ring.className = 'kc-hint-ring';
    const tag = document.createElement('div');
    tag.className = 'kc-hint-label';
    tag.textContent = label;
    hint.append(ring, tag);
    box.appendChild(hint);

    setTimeout(() => {
      hint.style.transition = 'opacity 0.25s ease';
      hint.style.opacity = '0';
      setTimeout(() => hint.remove(), 280);
    }, durationMs);
  }

  // 警告 / 降级提示。用正常不透明度，30% 的警告等于没有警告。
  function toast(text, kind = 'warn', ms = 3800) {
    const box = container();
    const el = document.createElement('div');
    el.className = 'kc-toast';
    el.dataset.kind = kind;
    el.textContent = text;
    box.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity 0.3s ease';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 320);
    }, ms);
  }

  // 录制模式的十字准星
  function setReticle(x, y, on, text) {
    const box = container();
    let reticle = box.querySelector('.kc-reticle');
    if (!reticle) {
      reticle = document.createElement('div');
      reticle.className = 'kc-reticle';
      const label = document.createElement('div');
      label.className = 'kc-reticle-label';
      reticle.appendChild(label);
      box.appendChild(reticle);
    }
    reticle.dataset.on = on ? 'true' : 'false';
    if (!on) return;
    reticle.style.left = `${x}px`;
    reticle.style.top = `${y}px`;
    reticle.querySelector('.kc-reticle-label').textContent = text;
  }

  // 录制中的临时预览点，复用标记的圆形几何但换成红色系；保存后由持久标记接管
  function setDraftPoints(points) {
    const box = container();
    let layer = box.querySelector('.kc-drafts');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'kc-drafts';
      box.appendChild(layer);
    }
    layer.textContent = '';
    if (!Array.isArray(points)) return;
    points.forEach((point, index) => {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      const badge = document.createElement('div');
      badge.className = 'kc-badge kc-draft';
      badge.style.left = `${point.x}px`;
      badge.style.top = `${point.y}px`;
      badge.textContent = String(index + 1);
      layer.appendChild(badge);
    });
  }

  KC.hint = { ensure, show, toast, setReticle, setDraftPoints };
})();
