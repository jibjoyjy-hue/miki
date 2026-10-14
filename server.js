// เซิร์ฟเวอร์เล็กๆ ไม่ต้องติดตั้งแพ็กเกจเพิ่ม: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const file = (n) => path.join(__dirname, n + '.json');
const read = (n) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return []; } };
const write = (n, d) => fs.writeFileSync(file(n), JSON.stringify(d, null, 2));

const send = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};
const body = (req, cb) => {
  let b = '';
  req.on('data', c => { b += c; if (b.length > 2e4) req.destroy(); });
  req.on('end', () => { try { cb(JSON.parse(b)); } catch { cb(null); } });
};

http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/api/requests' && req.method === 'GET') return send(res, 200, read('requests'));

  if (url === '/api/requests' && req.method === 'POST') {
    return body(req, (j) => {
      const name = String((j && j.name) || '').trim().slice(0, 60);
      if (!name) return send(res, 400, { error: 'name required' });
      const list = read('requests');
      const last = list[list.length - 1];
      if (last && last.name === name && Date.now() - new Date(last.time).getTime() < 15000)
        return send(res, 201, { ok: true, duplicate: true });
      list.push({ name, time: new Date().toISOString() });
      write('requests', list);
      send(res, 201, { ok: true });
    });
  }

  if (url === '/api/quests' && req.method === 'GET') return send(res, 200, read('quests'));

  if (url === '/api/quests' && req.method === 'POST') {
    return body(req, (j) => {
      const title = String((j && j.title) || '').trim().slice(0, 100);
      const desc = String((j && j.desc) || '').trim().slice(0, 500);
      const credit = Math.max(0, Math.floor(Number(j && j.credit) || 0));
      const assignees = Array.isArray(j && j.assignees)
        ? j.assignees.map(a => String(a).slice(0, 60)).slice(0, 200) : [];
      if (!title) return send(res, 400, { error: 'title required' });
      const list = read('quests');
      list.push({ id: Date.now(), title, desc, credit, assignees, time: new Date().toISOString() });
      write('quests', list);
      send(res, 201, { ok: true });
    });
  }

  if (url === '/api/claims' && req.method === 'GET') return send(res, 200, read('claims'));

  if (url === '/api/claims' && req.method === 'POST') {
    return body(req, (j) => {
      const questId = Number(j && j.questId);
      const name = String((j && j.name) || '').trim();
      const quest = read('quests').find(q => q.id === questId);
      if (!quest || !quest.assignees.includes(name)) return send(res, 400, { error: 'invalid' });
      const claims = read('claims');
      if (claims.some(c => c.questId === questId && c.name === name && c.status !== 'rejected'))
        return send(res, 200, { ok: true, duplicate: true });
      claims.push({ id: Date.now(), questId, name, credit: quest.credit, title: quest.title, status: 'pending', time: new Date().toISOString() });
      write('claims', claims);
      send(res, 201, { ok: true });
    });
  }

  if (url === '/api/claims/decide' && req.method === 'POST') {
    return body(req, (j) => {
      const status = j && j.status;
      if (status !== 'approved' && status !== 'rejected') return send(res, 400, { error: 'bad status' });
      const claims = read('claims');
      const c = claims.find(x => x.id === Number(j.id));
      if (!c) return send(res, 404, { error: 'not found' });
      if (c.status !== 'pending') return send(res, 200, { ok: true, already: c.status });
      c.status = status;
      c.decidedAt = new Date().toISOString();
      write('claims', claims);
      send(res, 200, { ok: true });
    });
  }

  if (url === '/api/balance' && req.method === 'GET') {
    const name = new URL(req.url, 'http://x').searchParams.get('name') || '';
    const credit = read('claims').filter(c => c.name === name && c.status === 'approved')
      .reduce((s, c) => s + c.credit, 0);
    return send(res, 200, { credit });
  }

  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
  }

  res.writeHead(404); res.end('Not found');
}).listen(PORT, '0.0.0.0', () => console.log('Running on http://localhost:' + PORT));
