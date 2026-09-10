(() => {
  const CK = self.COORDKEY;

  const FONT =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

  const WIDGET_CSS = `
    .ck-root {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      font-family: ${FONT};
      font-size: 13px;
      line-height: 1.5;
      color: #e8eaf2;
      pointer-events: none;
    }
    .ck-root * { box-sizing: border-box; }

    .ck-fab {
      pointer-events: auto;
      width: 44px;
      height: 44px;
      padding: 0;
      border: none;
      border-radius: 50%;
      cursor: pointer;
      background: linear-gradient(135deg, #4f7cff, #7b4fff);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 14px rgba(40, 60, 160, 0.45);
      transition: transform 0.15s ease;
    }
    .ck-fab:hover { transform: scale(1.06); }
    .ck-fab svg { width: 22px; height: 22px; display: block; }
    .ck-fab[data-state="off"] { filter: grayscale(1); opacity: 0.55; }

    .ck-panel {
      pointer-events: auto;
      position: absolute;
      right: 0;
      bottom: 54px;
      width: 348px;
      max-height: min(600px, calc(100vh - 90px));
      overflow-y: auto;
      background: rgba(22, 25, 38, 0.97);
      /* 亮环管深色页面、暗投影管浅色页面：单靠其一，总有一种背景下轮廓会消失 */
      border: 1px solid rgba(255, 255, 255, 0.24);
      border-radius: 12px;
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.12),
        0 12px 40px rgba(0, 0, 0, 0.5);
      padding: 14px;
      display: none;
    }
    .ck-panel[data-open="true"] { display: block; }

    .ck-head {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }
    .ck-title { flex: 1; font-weight: 600; font-size: 14px; }
    .ck-ver {
      font-size: 10px;
      color: #6b7280;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .ck-iconbtn {
      pointer-events: auto;
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 6px;
      color: #9aa3b8;
      font-size: 12px;
      line-height: 1;
      padding: 4px 7px;
      cursor: pointer;
    }
    .ck-iconbtn:hover { color: #fff; border-color: rgba(255, 255, 255, 0.35); }
    .ck-iconbtn:disabled { opacity: 0.35; cursor: default; }
    .ck-iconbtn:disabled:hover { color: #9aa3b8; border-color: rgba(255, 255, 255, 0.15); }

    .ck-section { margin-bottom: 14px; }
    .ck-section:last-child { margin-bottom: 0; }
    .ck-sec-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #8b93a7;
      margin-bottom: 8px;
      word-break: break-all;
    }
    .ck-sec-head { display: flex; align-items: flex-start; gap: 8px; }
    .ck-sec-head > span:first-child { flex: 1; min-width: 0; }
    .ck-sec-head .ck-mini { flex: none; text-transform: none; letter-spacing: 0; }
    .ck-origin { text-transform: none; }

    .ck-btn {
      pointer-events: auto;
      width: 100%;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 8px;
      color: #e8eaf2;
      font-size: 13px;
      font-family: inherit;
      padding: 8px 10px;
      cursor: pointer;
    }
    .ck-btn:hover { background: rgba(255, 255, 255, 0.14); }
    .ck-btn-primary {
      background: linear-gradient(135deg, #4f7cff, #7b4fff);
      border-color: transparent;
      font-weight: 600;
    }
    .ck-btn-primary:hover { filter: brightness(1.1); }
    .ck-btn-danger { color: #ff8a8a; }
    .ck-row2 { display: flex; gap: 8px; }
    .ck-row2 .ck-btn { flex: 1; }

    .ck-record-status {
      margin-top: 8px;
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(123, 79, 255, 0.16);
      border: 1px solid rgba(123, 79, 255, 0.4);
      font-size: 12px;
    }
    .ck-record-status[data-kind="error"] {
      background: rgba(255, 84, 112, 0.14);
      border-color: rgba(255, 84, 112, 0.45);
      color: #ffb3c0;
    }

    .ck-rules { display: flex; flex-direction: column; gap: 8px; }
    /* 上面的 display:flex 会盖掉 UA 的 [hidden]，收起列表得显式再写一条 */
    .ck-rules[hidden] { display: none; }
    .ck-empty { color: #6b7280; font-size: 12px; padding: 6px 2px; }
    .ck-rule {
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 8px 10px;
    }
    .ck-rule-top { display: flex; align-items: center; gap: 8px; }
    .ck-kbd {
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-bottom-width: 2px;
      border-radius: 5px;
      padding: 1px 7px;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: nowrap;
    }
    .ck-rule-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #cdd3e0;
    }
    .ck-rule-coord { font-size: 11px; color: #6b7280; white-space: nowrap; }
    .ck-rule-interval {
      display: flex;
      align-items: center;
      gap: 5px;
      margin-top: 7px;
      font-size: 11px;
      color: #8b93a7;
    }
    .ck-rule-interval input[type="number"],
    .ck-step input[type="number"] {
      pointer-events: auto;
      width: 66px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 6px;
      color: #e8eaf2;
      font-family: inherit;
      font-size: 11px;
      padding: 3px 6px;
    }
    .ck-step input[type="number"][data-custom="true"] {
      border-color: rgba(143, 107, 255, 0.8);
      color: #ddd0ff;
    }

    .ck-steps {
      margin-top: 7px;
      padding: 7px 8px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.04);
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .ck-step {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      color: #8b93a7;
    }
    .ck-step-no {
      flex: none;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: rgba(143, 107, 255, 0.5);
      color: #fff;
      font-size: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .ck-step-coord {
      flex: 1;
      min-width: 0;
      color: #aab2c5;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ck-step-tail { color: #6b7280; }
    .ck-step .ck-mini { padding: 2px 6px; }
    .ck-rule-actions { display: flex; gap: 6px; margin-top: 7px; }
    .ck-mini {
      pointer-events: auto;
      background: rgba(255, 255, 255, 0.07);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      color: #aab2c5;
      font-size: 11px;
      font-family: inherit;
      padding: 3px 9px;
      cursor: pointer;
    }
    .ck-mini:hover { color: #fff; background: rgba(255, 255, 255, 0.14); }
    .ck-mini[data-act="delete"]:hover { color: #ff8a8a; }

    .ck-switch-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      cursor: pointer;
      user-select: none;
    }
    .ck-switch-row input { accent-color: #7b4fff; width: 15px; height: 15px; }
    .ck-field {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 4px 0;
      color: #cdd3e0;
    }
    .ck-field input[type="number"] {
      width: 84px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 6px;
      color: #e8eaf2;
      font-family: inherit;
      font-size: 12px;
      padding: 4px 7px;
    }
    .ck-field input[type="range"] { width: 130px; accent-color: #7b4fff; }
    .ck-field .ck-val { width: 44px; text-align: right; font-size: 11px; color: #8b93a7; }

    .ck-scheme-row { display: flex; align-items: center; gap: 6px; }
    .ck-select {
      pointer-events: auto;
      flex: 1;
      min-width: 0;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 6px;
      color: #e8eaf2;
      font-family: inherit;
      font-size: 12px;
      padding: 5px 7px;
    }
    .ck-select option { background: #1b1f2e; color: #e8eaf2; }
    .ck-scheme-hint { margin-top: 6px; font-size: 11px; color: #6b7280; }

    .ck-import-box {
      margin-top: 8px;
      padding: 10px;
      border: 1px solid rgba(123, 79, 255, 0.4);
      border-radius: 8px;
      background: rgba(123, 79, 255, 0.1);
      font-size: 12px;
    }
    .ck-import-box .ck-row2 { margin-top: 8px; }
  `;

  const HINT_CSS = `
    .ck-hint-root {
      position: fixed;
      inset: 0;
      pointer-events: none;
      font-family: ${FONT};
      font-size: 13px;
      color: #e8eaf2;
    }
    .ck-hint-root * { box-sizing: border-box; }

    .ck-hint {
      position: absolute;
      transform: translate(-50%, -50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 5px;
      pointer-events: none;
    }
    .ck-hint-ring {
      position: absolute;
      left: 0;
      top: 0;
      width: 58px;
      height: 58px;
      margin: -29px 0 0 -29px;
      border: 2px solid #8f6bff;
      border-radius: 50%;
      animation: ck-ring 0.6s ease-out forwards;
    }
    @keyframes ck-ring {
      from { transform: scale(0.35); opacity: 1; }
      to { transform: scale(1.7); opacity: 0; }
    }
    .ck-hint-label {
      background: rgba(18, 22, 38, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.4);
      border-radius: 6px;
      padding: 3px 9px;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: nowrap;
    }

    .ck-toast {
      position: fixed;
      top: 18px;
      left: 50%;
      transform: translateX(-50%);
      max-width: min(560px, 90vw);
      background: rgba(18, 22, 38, 0.95);
      border: 1px solid rgba(255, 209, 102, 0.5);
      border-radius: 8px;
      padding: 8px 14px;
      font-size: 12px;
      color: #ffe0a3;
      pointer-events: none;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
    }
    .ck-toast[data-kind="error"] { border-color: rgba(255, 84, 112, 0.6); color: #ffb3c0; }
    .ck-toast[data-kind="ok"] { border-color: rgba(52, 211, 153, 0.6); color: #a7f3d0; }

    .ck-reticle {
      position: absolute;
      width: 0;
      height: 0;
      pointer-events: none;
      display: none;
    }
    .ck-reticle[data-on="true"] { display: block; }
    .ck-reticle::before,
    .ck-reticle::after {
      content: "";
      position: absolute;
      background: #ff5470;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.5);
    }
    .ck-reticle::before { left: -15px; top: -1px; width: 30px; height: 2px; }
    .ck-reticle::after { left: -1px; top: -15px; width: 2px; height: 30px; }
    .ck-reticle-label {
      position: absolute;
      left: 14px;
      top: 14px;
      background: rgba(18, 22, 38, 0.94);
      border: 1px solid rgba(255, 84, 112, 0.5);
      border-radius: 5px;
      padding: 2px 8px;
      font-size: 11px;
      white-space: nowrap;
      color: #ffd7de;
    }

    /* 持久标记与录制预览共用同一套几何：正中标在触发点上，
       1–2 个字符时是直径 26px 的正圆，标签更长时自动长成胶囊，不会截断 */
    .ck-markers { position: absolute; inset: 0; pointer-events: none; }
    .ck-badge {
      position: absolute;
      transform: translate(-50%, -50%);
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 26px;
      min-height: 26px;
      padding: 0 6px;
      border: 1px solid rgba(255, 255, 255, 0.75);
      border-radius: 999px;
      background: rgba(143, 107, 255, 0.55);
      color: #fff;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      line-height: 1;
      white-space: nowrap;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
      pointer-events: none;
    }
    .ck-drafts { position: absolute; inset: 0; pointer-events: none; }
    .ck-badge.ck-draft {
      background: rgba(255, 84, 112, 0.6);
      border-color: rgba(255, 255, 255, 0.7);
      color: #fff2f5;
    }
  `;

  CK.styles = { WIDGET_CSS, HINT_CSS };
})();
