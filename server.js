// เซิร์ฟเวอร์เล็กๆ ไม่ต้องติดตั้งแพ็กเกจเพิ่ม: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const file = (n) => path.join(__dirname, n + '.json');
const read = (n) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return []; } };
const write = (n, d) => fs.writeFileSync(file(n), JSON.stringify(d, null, 2));

const readShop = () => read('shop');

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

  if (url === '/api/requests' && req.method === 'GET') {
    const list = read('requests').map((r, i) => ({
      id: r.id || (Date.parse(r.time) ? Date.parse(r.time) + i : i + 1),
      name: r.name,
      time: r.time || new Date().toISOString(),
      status: r.status || 'pending'
    }));
    return send(res, 200, list);
  }

  if (url === '/api/requests' && req.method === 'POST') {
    return body(req, (j) => {
      const name = String((j && j.name) || '').trim().slice(0, 60);
      if (!name) return send(res, 400, { error: 'name required' });
      const list = read('requests');
      const existing = list.find(x => x.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        if (!existing.id) existing.id = Date.now();
        if (!existing.status) existing.status = 'pending';
        write('requests', list);
        return send(res, 200, { ok: true, existing: true, status: existing.status, id: existing.id });
      }
      const item = { id: Date.now(), name, status: 'pending', time: new Date().toISOString() };
      list.push(item);
      write('requests', list);
      send(res, 201, { ok: true, status: 'pending', id: item.id });
    });
  }

  if (url === '/api/requests/decide' && req.method === 'POST') {
    return body(req, (j) => {
      const status = j && j.status;
      if (status !== 'approved' && status !== 'rejected') return send(res, 400, { error: 'bad status' });
      const list = read('requests');
      const targetId = j && j.id;
      const targetName = j && j.name;
      const r = list.find(x => (targetId && String(x.id) === String(targetId)) || (targetName && x.name === targetName));
      if (!r) return send(res, 404, { error: 'not found' });
      r.status = status;
      if (!r.id && targetId) r.id = Number(targetId) || targetId;
      r.decidedAt = new Date().toISOString();
      write('requests', list);
      return send(res, 200, { ok: true, request: r });
    });
  }

  if (url === '/api/requests/check' && req.method === 'GET') {
    const name = new URL(req.url, 'http://x').searchParams.get('name') || '';
    const list = read('requests');
    const r = list.find(x => x.name.toLowerCase() === name.toLowerCase().trim());
    if (!r) return send(res, 200, { exists: false });
    return send(res, 200, { exists: true, status: r.status || 'pending', name: r.name });
  }

  if (url === '/api/requests/add' && req.method === 'POST') {
    return body(req, (j) => {
      const name = String((j && j.name) || '').trim().slice(0, 60);
      if (!name) return send(res, 400, { error: 'name required' });
      const list = read('requests');
      let r = list.find(x => x.name.toLowerCase() === name.toLowerCase());
      if (!r) {
        r = { id: Date.now(), name, status: 'approved', time: new Date().toISOString() };
        list.push(r);
      } else {
        r.status = 'approved';
      }
      write('requests', list);
      send(res, 201, { ok: true, request: r });
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
    const earned = read('claims').filter(c => c.name === name && c.status === 'approved')
      .reduce((s, c) => s + c.credit, 0);
    const spent = read('redemptions').filter(r => r.user === name && r.status !== 'cancelled')
      .reduce((s, r) => s + r.credit, 0);
    const credit = Math.max(0, earned - spent);
    return send(res, 200, { credit, earned, spent });
  }

  if (url === '/api/shop/items' && req.method === 'GET') {
    return send(res, 200, readShop());
  }

  if (url === '/api/shop/items' && req.method === 'POST') {
    return body(req, (j) => {
      const title = String((j && j.title) || '').trim().slice(0, 100);
      const desc = String((j && j.desc) || '').trim().slice(0, 500);
      const credit = Math.max(1, Math.floor(Number(j && j.credit) || 0));
      const stock = Math.max(0, Math.floor(Number(j && j.stock) || 0));
      const icon = String((j && j.icon) || '🎁').trim().slice(0, 10);
      if (!title || !credit) return send(res, 400, { error: 'title and credit required' });
      const list = readShop();
      const item = { id: Date.now(), title, desc, credit, icon: icon || '🎁', stock: stock || 10 };
      list.push(item);
      write('shop', list);
      send(res, 201, { ok: true, item });
    });
  }

  if (url === '/api/shop/items/delete' && req.method === 'POST') {
    return body(req, (j) => {
      const id = Number(j && j.id);
      if (!id) return send(res, 400, { error: 'id required' });
      let list = readShop();
      list = list.filter(x => x.id !== id);
      write('shop', list);
      send(res, 200, { ok: true });
    });
  }

  if (url === '/api/shop/redeem' && req.method === 'POST') {
    return body(req, (j) => {
      const itemId = Number(j && j.itemId);
      const user = String((j && j.user) || '').trim();
      if (!itemId || !user) return send(res, 400, { error: 'itemId and user required' });
      const shopItems = readShop();
      const item = shopItems.find(x => x.id === itemId);
      if (!item) return send(res, 404, { error: 'item not found' });
      if (typeof item.stock === 'number' && item.stock <= 0) {
        return send(res, 400, { error: 'out_of_stock', message: 'ของรางวัลนี้หมดแล้ว' });
      }

      const earned = read('claims').filter(c => c.name === user && c.status === 'approved')
        .reduce((s, c) => s + c.credit, 0);
      const spent = read('redemptions').filter(r => r.user === user && r.status !== 'cancelled')
        .reduce((s, r) => s + r.credit, 0);
      const balance = Math.max(0, earned - spent);

      if (balance < item.credit) {
        return send(res, 400, {
          error: 'insufficient_credit',
          message: 'เครดิตไม่เพียงพอ (ต้องการ 🪙 ' + item.credit + ' แต่คุณมี 🪙 ' + balance + ')'
        });
      }

      if (typeof item.stock === 'number') {
        item.stock = Math.max(0, item.stock - 1);
        write('shop', shopItems);
      }

      const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
      const code = 'MK-' + rand;
      const redemptions = read('redemptions');
      const redemption = {
        id: Date.now(),
        code,
        itemId: item.id,
        itemTitle: item.title,
        itemIcon: item.icon || '🎁',
        credit: item.credit,
        user,
        status: 'pending',
        time: new Date().toISOString()
      };
      redemptions.push(redemption);
      write('redemptions', redemptions);

      send(res, 201, {
        ok: true,
        redemption,
        newBalance: balance - item.credit
      });
    });
  }

  if (url === '/api/shop/redemptions' && req.method === 'GET') {
    const user = new URL(req.url, 'http://x').searchParams.get('user') || '';
    const all = read('redemptions');
    if (!user) return send(res, 200, all);
    return send(res, 200, all.filter(r => r.user === user));
  }

  if (url === '/api/shop/redemptions/decide' && req.method === 'POST') {
    return body(req, (j) => {
      const id = Number(j && j.id);
      const status = j && j.status;
      if (!id || (status !== 'fulfilled' && status !== 'cancelled')) {
        return send(res, 400, { error: 'invalid request' });
      }
      const redemptions = read('redemptions');
      const r = redemptions.find(x => x.id === id);
      if (!r) return send(res, 404, { error: 'redemption not found' });
      r.status = status;
      r.decidedAt = new Date().toISOString();

      if (status === 'cancelled') {
        const shop = readShop();
        const item = shop.find(x => x.id === r.itemId);
        if (item && typeof item.stock === 'number') {
          item.stock++;
          write('shop', shop);
        }
      }
      write('redemptions', redemptions);
      send(res, 200, { ok: true, redemption: r });
    });
  }

  if (url === '/api/messages' && req.method === 'GET') {
    const user = new URL(req.url, 'http://x').searchParams.get('user') || '';
    const all = read('messages');
    if (!user) return send(res, 200, all);
    const filtered = all.filter(m => m.user === user || m.from === user || m.to === user);
    return send(res, 200, filtered);
  }

  if (url === '/api/messages' && req.method === 'POST') {
    return body(req, (j) => {
      const user = String((j && j.user) || '').trim().slice(0, 60);
      const text = String((j && j.text) || '').trim().slice(0, 1000);
      const sender = (j && j.sender) === 'admin' ? 'admin' : 'user';
      if (!user || !text) return send(res, 400, { error: 'user and text required' });
      const list = read('messages');
      const item = {
        id: Date.now(),
        user,
        sender,
        text,
        time: new Date().toISOString(),
        read: sender === 'admin'
      };
      list.push(item);
      write('messages', list);
      send(res, 201, { ok: true, message: item });
    });
  }

  if (url === '/api/messages/requests' && req.method === 'GET') {
    const all = read('messages');
    const userMap = {};
    all.forEach(m => {
      if (!userMap[m.user]) userMap[m.user] = { user: m.user, lastMsg: m.text, lastTime: m.time, unread: 0 };
      userMap[m.user].lastMsg = m.text;
      userMap[m.user].lastTime = m.time;
      if (m.sender === 'user' && !m.read) userMap[m.user].unread++;
    });
    const list = Object.values(userMap).sort((a, b) => new Date(b.lastTime) - new Date(a.lastTime));
    return send(res, 200, list);
  }

  if (url === '/api/messages/read' && req.method === 'POST') {
    return body(req, (j) => {
      const user = String((j && j.user) || '').trim();
      if (!user) return send(res, 400, { error: 'user required' });
      const list = read('messages');
      list.forEach(m => {
        if (m.user === user && m.sender === 'user') m.read = true;
      });
      write('messages', list);
      send(res, 200, { ok: true });
    });
  }

  if (url === '/api/sync/customer' && req.method === 'POST') {
    return body(req, (j) => {
      const name = String((j && j.name) || '').trim().slice(0, 60);
      const status = (j && j.status) === 'rejected' ? 'rejected' : 'approved';
      if (!name) return send(res, 400, { error: 'name required' });
      const list = read('requests');
      let r = list.find(x => x.name.toLowerCase() === name.toLowerCase());
      if (!r) {
        r = { id: Date.now(), name, status, time: new Date().toISOString(), restored: true };
        list.push(r);
        write('requests', list);
        return send(res, 201, { ok: true, restored: true, request: r });
      }
      return send(res, 200, { ok: true, existing: true, request: r });
    });
  }

  if (url === '/api/sync/backup' && req.method === 'POST') {
    return body(req, (j) => {
      if (!j) return send(res, 400, { error: 'data required' });
      if (Array.isArray(j.requests) && j.requests.length) {
        const current = read('requests');
        const currentNames = new Set(current.map(x => x.name.toLowerCase()));
        let added = 0;
        j.requests.forEach(r => {
          if (r && r.name && !currentNames.has(r.name.toLowerCase())) {
            current.push(r);
            currentNames.add(r.name.toLowerCase());
            added++;
          }
        });
        if (added > 0 || !current.length) write('requests', current);
      }
      if (Array.isArray(j.quests) && j.quests.length) {
        const current = read('quests');
        const currentIds = new Set(current.map(x => String(x.id)));
        let added = 0;
        j.quests.forEach(q => {
          if (q && q.title && !currentIds.has(String(q.id))) {
            current.push(q);
            currentIds.add(String(q.id));
            added++;
          }
        });
        if (added > 0 || !current.length) write('quests', current);
      }
      if (Array.isArray(j.claims) && j.claims.length) {
        const current = read('claims');
        const currentIds = new Set(current.map(x => String(x.id)));
        let added = 0;
        j.claims.forEach(c => {
          if (c && !currentIds.has(String(c.id))) {
            current.push(c);
            currentIds.add(String(c.id));
            added++;
          }
        });
        if (added > 0 || !current.length) write('claims', current);
      }
      if (Array.isArray(j.messages) && j.messages.length) {
        const current = read('messages');
        const currentIds = new Set(current.map(x => String(x.id)));
        let added = 0;
        j.messages.forEach(m => {
          if (m && !currentIds.has(String(m.id))) {
            current.push(m);
            currentIds.add(String(m.id));
            added++;
          }
        });
        if (added > 0 || !current.length) write('messages', current);
      }
      if (Array.isArray(j.shop) && j.shop.length) {
        const current = readShop();
        const currentIds = new Set(current.map(x => String(x.id)));
        let added = 0;
        j.shop.forEach(s => {
          if (s && s.title && !currentIds.has(String(s.id))) {
            current.push(s);
            currentIds.add(String(s.id));
            added++;
          }
        });
        if (added > 0) write('shop', current);
      }
      if (Array.isArray(j.redemptions) && j.redemptions.length) {
        const current = read('redemptions');
        const currentIds = new Set(current.map(x => String(x.id)));
        let added = 0;
        j.redemptions.forEach(r => {
          if (r && !currentIds.has(String(r.id))) {
            current.push(r);
            currentIds.add(String(r.id));
            added++;
          }
        });
        if (added > 0 || !current.length) write('redemptions', current);
      }
      send(res, 200, { ok: true, requestsCount: read('requests').length });
    });
  }

  if (url === '/api/export' && req.method === 'GET') {
    return send(res, 200, {
      requests: read('requests'),
      quests: read('quests'),
      claims: read('claims'),
      messages: read('messages'),
      shop: readShop(),
      redemptions: read('redemptions'),
      exportedAt: new Date().toISOString()
    });
  }

  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
  }

  res.writeHead(404); res.end('Not found');
}).listen(PORT, '0.0.0.0', () => console.log('Running on http://localhost:' + PORT));
