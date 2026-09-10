(() => {
  const CK = self.COORDKEY;

  const MODIFIER_CODES = new Set([
    'ControlLeft', 'ControlRight',
    'AltLeft', 'AltRight',
    'ShiftLeft', 'ShiftRight',
    'MetaLeft', 'MetaRight',
  ]);

  // Chrome / 操作系统保留、永远不会送达页面内容的组合键。
  // 黑名单只负责给出即时明确反馈，漏网的由录制后的「自检」兜底。
  const RESERVED = new Set([
    'Ctrl+KeyT', 'Ctrl+KeyW', 'Ctrl+KeyN',
    'Ctrl+Shift+KeyT', 'Ctrl+Shift+KeyW', 'Ctrl+Shift+KeyN',
    'Ctrl+Tab', 'Ctrl+Shift+Tab',
    'Ctrl+Digit1', 'Ctrl+Digit2', 'Ctrl+Digit3', 'Ctrl+Digit4', 'Ctrl+Digit5',
    'Ctrl+Digit6', 'Ctrl+Digit7', 'Ctrl+Digit8', 'Ctrl+Digit9',
    'Ctrl+KeyL', 'Ctrl+KeyF', 'Ctrl+KeyP', 'Ctrl+KeyS', 'Ctrl+KeyG',
    'Ctrl+KeyH', 'Ctrl+KeyJ', 'Ctrl+KeyD', 'Ctrl+KeyU', 'Ctrl+KeyK',
    'Ctrl+KeyE', 'Ctrl+KeyY',
    'Ctrl+Shift+KeyJ', 'Ctrl+Shift+KeyI', 'Ctrl+Shift+KeyC',
    'Ctrl+Equal', 'Ctrl+Minus', 'Ctrl+Digit0', 'Ctrl+Shift+Equal',
    'F3', 'F5', 'F6', 'F7', 'F10', 'F11', 'F12',
    'Alt+Home', 'Alt+ArrowLeft', 'Alt+ArrowRight', 'Alt+KeyD', 'Alt+KeyF', 'Alt+KeyE',
  ]);

  const MOD_ORDER = ['ctrl', 'alt', 'shift', 'meta'];
  const MOD_LABEL = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Meta' };
  const MOD_SYMBOL = { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' };
  const KEY_LABEL = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    Space: '␣', Enter: '⏎', NumpadEnter: '⏎', Tab: '⇥',
    Backspace: '⌫', Delete: '⌦', Insert: 'Ins',
    Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
  };

  function comboFromEvent(event) {
    if (!event || !event.code) return null;
    if (MODIFIER_CODES.has(event.code)) return null;
    return {
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      meta: event.metaKey,
      code: event.code,
      key: event.key,
    };
  }

  function comboId(combo) {
    const parts = MOD_ORDER.filter((m) => combo[m]).map((m) => MOD_LABEL[m]);
    parts.push(combo.code);
    return parts.join('+');
  }

  function displayKey(combo) {
    const { code, key } = combo;
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
    if (KEY_LABEL[code]) return KEY_LABEL[code];
    if (/^F\d{1,2}$/.test(code)) return code;
    if (key && key.length === 1) return key.toUpperCase();
    return key || code;
  }

  function comboLabel(combo) {
    const parts = MOD_ORDER.filter((m) => combo[m]).map((m) => MOD_LABEL[m]);
    parts.push(displayKey(combo));
    return parts.join(' + ');
  }

  // 标记浮层用的紧凑写法：Shift+H -> "⇧H"，单键 H -> "H"
  function comboSymbols(combo) {
    const mods = MOD_ORDER.filter((m) => combo[m]).map((m) => MOD_SYMBOL[m]).join('');
    return mods + displayKey(combo);
  }

  // 组播放时逐步浮现的标签：多步带进度，单步就是快捷键本身
  function stepLabel(shortcut, step) {
    const label = comboLabel(shortcut);
    return step && step.total > 1 ? `${step.index + 1}/${step.total} ${label}` : label;
  }

  function validate(combo) {
    const id = comboId(combo);
    if (RESERVED.has(id)) {
      return {
        ok: false,
        reason: `${comboLabel(combo)} 是浏览器或系统保留的快捷键，页面永远收不到，请换一个按键或组合。`,
      };
    }
    if (combo.code === 'Escape') {
      return { ok: false, reason: 'Escape 被保留用于取消录制和关闭面板。' };
    }
    return { ok: true, id };
  }

  function matchesEvent(rule, event) {
    const combo = rule.shortcut;
    if (!combo) return false;
    return (
      combo.code === event.code &&
      !!combo.ctrl === event.ctrlKey &&
      !!combo.alt === event.altKey &&
      !!combo.shift === event.shiftKey &&
      !!combo.meta === event.metaKey
    );
  }

  CK.hotkeys = { comboFromEvent, comboId, comboLabel, comboSymbols, stepLabel, displayKey, validate, matchesEvent, RESERVED };
})();
