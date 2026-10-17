// Mock OpenAI-compatible LLM for tests (T04/T07). Start standalone or import
// startMockLlm() in-process. Scenario = array of scripted assistant messages.
import http from 'node:http';

export function startMockLlm() {
  const scenarios = [];
  const requests = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body);
        requests.push(parsed);
        const script = scenarios.length ? scenarios[0] : [{ content: 'mock default reply' }];
        const next = script.shift();
        if (!script.length) scenarios.shift();
        if (next && next.__error) {
          res.writeHead(next.__error.status || 500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: next.__error.message || 'mock error' } }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{ message: next || { content: 'empty' } }],
          // T41: optional per-response token metering passthrough
          ...(next && next.__usage ? { usage: { total_tokens: next.__usage } } : {}),
        }));
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        baseUrl: 'http://127.0.0.1:' + port + '/v1',
        push(scenario) { scenarios.push(scenario); return this; },
        requests,
        close() { return new Promise((r) => server.close(r)); },
      });
    });
  });
}

if (process.argv[1] && process.argv[1].endsWith('mock-llm.mjs')) {
  startMockLlm().then((m) => console.log('mock-llm on', m.baseUrl));
}
