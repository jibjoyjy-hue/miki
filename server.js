// เซิร์ฟเวอร์เล็กๆ ไม่ต้องติดตั้งแพ็กเกจเพิ่ม: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'requests.json');

const read = () => { try { return JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch { return []; } };
const write = (d) => fs.writeFileSync(DATA, JSON.stringify(d, null, 2));

http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/api/requests' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(read()));
  }

  if (url === '/api/requests' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on('end', () => {
      try {
        const name = String(JSON.parse(body).name || '').trim().slice(0, 60);
        if (!name) { res.writeHead(400); return res.end('{"error":"name required"}'); }
        const list = read();
        list.push({ name, time: new Date().toISOString() });
        write(list);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch { res.writeHead(400); res.end('{"error":"bad request"}'); }
    });
    return;
  }

  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
  }

  res.writeHead(404); res.end('Not found');
}).listen(PORT, '0.0.0.0', () => console.log('Running on http://localhost:' + PORT));
