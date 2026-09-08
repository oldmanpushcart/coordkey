// 有头 Chrome 注入验证工具。
// 用法：先启动 chrome --remote-debugging-port=9333 --load-extension=<dir>，
//       再运行 node tools/verify-inject.mjs
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = process.env.PORT || 9333;
const PAGE = process.env.PAGE || 'http://127.0.0.1:8931/';

let nextId = 0;

function makeSender(ws) {
  return (method, params = {}, sessionId) => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const handler = (event) => {
        const data = JSON.parse(event.data);
        if (data.id !== id) return;
        ws.removeEventListener('message', handler);
        if (data.error) reject(new Error(`${method}: ${JSON.stringify(data.error)}`));
        else resolve(data.result);
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  };
}

function collect(ws, sink) {
  ws.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (!data.method) return;
    if (data.method === 'Runtime.consoleAPICalled') {
      sink.console.push(
        `[console.${data.params.type}] ` +
          data.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '),
      );
    }
    if (data.method === 'Runtime.exceptionThrown') {
      const d = data.params.exceptionDetails;
      sink.exceptions.push(
        `[exception] ${d.text} @ ${d.url}:${d.lineNumber} ${d.exception?.description || ''}`,
      );
    }
    if (data.method === 'Log.entryAdded') {
      sink.logs.push(`[log.${data.params.entry.level}] ${data.params.entry.text}`);
    }
  });
}

async function main() {
  const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const browserWs = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => (browserWs.onopen = r));
  const browserSend = makeSender(browserWs);
  const sink = { console: [], exceptions: [], logs: [] };
  collect(browserWs, sink);

  const { targetId } = await browserSend('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browserSend('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => makeSender(browserWs)(method, params, sessionId);
  collect; // events for the session also arrive on the browser ws

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: PAGE });
  await sleep(2500);

  const probe = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true });
    return res.result.value;
  };

  const widget = await probe(`!!document.querySelector('[data-keyclick-widget]')`);
  const hint = await probe(`!!document.querySelector('[data-keyclick-hint]')`);
  const canvas = await probe(`!!document.querySelector('#stage')`);

  console.log('page canvas present :', canvas);
  console.log('content script widget:', widget ? 'INJECTED' : 'MISSING');
  console.log('hint host present    :', hint ? 'yes' : 'not yet (created lazily)');
  console.log('--- console ---');
  console.log(sink.console.join('\n') || '(none)');
  console.log('--- exceptions ---');
  console.log(sink.exceptions.join('\n') || '(none)');
  console.log('--- log ---');
  console.log(sink.logs.filter((l) => !l.includes('favicon')).join('\n') || '(none)');

  await browserSend('Target.closeTarget', { targetId });
  browserWs.close();
  process.exit(widget ? 0 : 1);
}

main().catch((err) => {
  console.error('VERIFY FAILED:', err.message);
  process.exit(2);
});
