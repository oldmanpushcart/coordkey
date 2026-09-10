// 内容脚本共享命名空间。内容脚本运行在隔离世界，挂到 self 上不会污染宿主页面。
// 常量、归一化与迁移在 protocol.js 里（SW 也要用），这里只放内容脚本独有的运行时状态。
(() => {
  const CK = self.COORDKEY;
  CK.origin = location.origin;

  CK.state = {
    panelOpen: false,
    recording: false,
  };

  const listeners = new Set();
  CK.on = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
  CK.emit = (event, payload) => {
    for (const fn of Array.from(listeners)) fn(event, payload);
  };
})();
