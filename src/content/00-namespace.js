// 内容脚本共享命名空间。内容脚本运行在隔离世界，挂到 self 上不会污染宿主页面。
(() => {
  const KC = self.KEYCLICK;
  KC.origin = location.origin;

  KC.state = {
    panelOpen: false,
    recording: false,
  };

  const listeners = new Set();
  KC.on = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
  KC.emit = (event, payload) => {
    for (const fn of Array.from(listeners)) fn(event, payload);
  };

  KC.uid = () =>
    'r_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
})();
