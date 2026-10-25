// เซิร์ฟเวอร์เล็กๆ ไม่ต้องติดตั้งแพ็กเกจเพิ่ม: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const file = (n) => path.join(__dirname, n + '.json');
const read = (n) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return []; } };
const write = (n, d) => fs.writeFileSync(file(n), JSON.stringify(d, null, 2));

const defaultShopItems = [
  { id: 1001, title: 'ส่วนลด 10% สำหรับการสั่งซื้อ', desc: 'ใช้เป็นส่วนลดสำหรับออเดอร์ถัดไป', credit: 50, icon: '🏷️', stock: 20 },
  { id: 1002, title: 'ขนม / เครื่องดื่มฟรี 1 รายการ', desc: 'เลือกรับเครื่องดื่มหรือของหวานฟรี', credit: 80, icon: '🥤', stock: 15 },
  { id: 1003, title: 'ของขวัญพรีเมียมจากร้าน', desc: 'ของที่ระลึกสุดพิเศษสำหรับลูกค้าประจำ', credit: 150, icon: '🎁', stock: 10 }
];
const readShop = () => {
  const list = read('shop');
  if (!Array.isArray(list) || !list.length) {
    write('shop', defaultShopItems);
    return defaultShopItems;
  }
  return list;
};

const getUserBalance = (name) => {
  const norm = String(name || '').trim().toLowerCase();
  const earned = read('claims').filter(c => (c.name || '').toLowerCase() === norm && c.status === 'approved')
    .reduce((s, c) => s + (Number(c.credit) || 0), 0);
  const giftCredits = read('gifts')
    .filter(g => Array.isArray(g.recipients) && g.recipients.some(r => (r || '').toLowerCase() === norm))
    .reduce((s, g) => s + (Number(g.credit) || 0), 0);
  const spent = read('redemptions').filter(r => (r.user || '').toLowerCase() === norm && r.status !== 'cancelled')
    .reduce((s, r) => s + (Number(r.credit) || 0), 0);
  const trades = read('trades');
  const tradeIn = trades.filter(t => (t.toUser || '').toLowerCase() === norm && (t.status === 'approved' || (!t.status && !t.cancelled)))
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const tradeOut = trades.filter(t => (t.fromUser || '').toLowerCase() === norm && (t.status === 'approved' || (!t.status && !t.cancelled)))
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const pendingTradeOut = trades.filter(t => (t.fromUser || '').toLowerCase() === norm && t.status === 'pending')
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const credit = earned + giftCredits + tradeIn - spent - tradeOut;
  const availableCredit = credit - pendingTradeOut;
  return { credit, availableCredit, pendingTradeOut, earned, giftCredits, spent, tradeIn, tradeOut };
};

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
      username: r.username || r.name,
      password: r.password || '',
      hasPassword: Boolean(r.password),
      time: r.time || new Date().toISOString(),
      status: r.status || 'pending'
    }));
    return send(res, 200, list);
  }

  if ((url === '/api/register' || url === '/api/requests') && req.method === 'POST') {
    return body(req, (j) => {
      const name = String((j && j.name) || '').trim().slice(0, 60);
      const username = String((j && (j.username || j.name)) || '').trim().slice(0, 60);
      const password = String((j && j.password) || '').trim().slice(0, 60);
      if (!name) return send(res, 400, { error: 'name_required', message: 'กรุณากรอกชื่อ' });
      if (!username) return send(res, 400, { error: 'username_required', message: 'กรุณากรอกชื่อผู้ใช้' });

      const list = read('requests');
      const existing = list.find(x => 
        (x.username && x.username.toLowerCase() === username.toLowerCase()) || 
        (x.name && x.name.toLowerCase() === name.toLowerCase())
      );
      if (existing) {
        if (password && existing.password && existing.password === password) {
          return send(res, 200, {
            ok: true,
            existing: true,
            id: existing.id,
            name: existing.name,
            username: existing.username || existing.name,
            status: existing.status || 'pending'
          });
        }
        return send(res, 400, {
          error: 'user_exists',
          message: 'ชื่อหรือชื่อผู้ใช้นี้มีคนใช้แล้ว หากเป็นบัญชีของคุณกรุณาเลือกเมนู "เข้าสู่ระบบ"'
        });
      }

      const item = {
        id: Date.now(),
        name,
        username,
        password: password || '1234',
        status: 'pending',
        time: new Date().toISOString()
      };
      list.push(item);
      write('requests', list);
      send(res, 201, {
        ok: true,
        status: 'pending',
        id: item.id,
        name: item.name,
        username: item.username
      });
    });
  }

  if (url === '/api/login' && req.method === 'POST') {
    return body(req, (j) => {
      const username = String((j && (j.username || j.name)) || '').trim();
      const password = String((j && j.password) || '').trim();
      if (!username) return send(res, 400, { error: 'username_required', message: 'กรุณากรอกชื่อผู้ใช้' });

      const list = read('requests');
      const norm = username.toLowerCase();
      const r = list.find(x => 
        (x.username && x.username.toLowerCase() === norm) || 
        (x.name && x.name.toLowerCase() === norm)
      );

      if (!r) {
        return send(res, 404, {
          error: 'user_not_found',
          message: 'ไม่พบบัญชีผู้ใช้นี้ กรุณาตรวจสอบชื่อผู้ใช้หรือกดสมัครแอคเคานต์ใหม่'
        });
      }

      if (r.password) {
        if (!password || String(r.password).trim() !== password) {
          return send(res, 401, {
            error: 'wrong_password',
            message: 'รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง'
          });
        }
      } else if (password) {
        // Set password for legacy account
        r.password = password;
        write('requests', list);
      }

      return send(res, 200, {
        ok: true,
        id: r.id,
        name: r.name,
        username: r.username || r.name,
        status: r.status || 'pending'
      });
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
    const name = (new URL(req.url, 'http://x').searchParams.get('name') || '').trim().toLowerCase();
    const list = read('requests');
    const r = list.find(x => 
      (x.name && x.name.toLowerCase() === name) ||
      (x.username && x.username.toLowerCase() === name)
    );
    if (!r) return send(res, 200, { exists: false });
    return send(res, 200, {
      exists: true,
      status: r.status || 'pending',
      name: r.name,
      username: r.username || r.name
    });
  }

  if (url === '/api/requests/add' && req.method === 'POST') {
    return body(req, (j) => {
      const name = String((j && j.name) || '').trim().slice(0, 60);
      const username = String((j && (j.username || j.name)) || '').trim().slice(0, 60);
      const password = String((j && j.password) || '1234').trim().slice(0, 60);
      if (!name) return send(res, 400, { error: 'name required' });
      const list = read('requests');
      let r = list.find(x => 
        (x.name && x.name.toLowerCase() === name.toLowerCase()) || 
        (x.username && x.username.toLowerCase() === username.toLowerCase())
      );
      if (!r) {
        r = { id: Date.now(), name, username, password, status: 'approved', time: new Date().toISOString() };
        list.push(r);
      } else {
        r.status = 'approved';
        if (!r.username) r.username = username;
        if (!r.password) r.password = password;
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

  if (url === '/api/quests/update' && req.method === 'POST') {
    return body(req, (j) => {
      const id = Number(j && j.id);
      const title = String((j && j.title) || '').trim().slice(0, 100);
      const desc = String((j && j.desc) || '').trim().slice(0, 500);
      const credit = Math.max(0, Math.floor(Number(j && j.credit) || 0));
      const assignees = Array.isArray(j && j.assignees)
        ? j.assignees.map(a => String(a).slice(0, 60)).slice(0, 200) : [];
      if (!id || !title) return send(res, 400, { error: 'id and title required' });
      const list = read('quests');
      const q = list.find(x => x.id === id);
      if (!q) return send(res, 404, { error: 'quest not found' });
      q.title = title;
      q.desc = desc;
      q.credit = credit;
      q.assignees = assignees;
      q.updatedAt = new Date().toISOString();
      write('quests', list);
      send(res, 200, { ok: true, quest: q });
    });
  }

  if (url === '/api/quests/delete' && req.method === 'POST') {
    return body(req, (j) => {
      const id = Number(j && j.id);
      if (!id) return send(res, 400, { error: 'id required' });
      let list = read('quests');
      list = list.filter(x => x.id !== id);
      write('quests', list);
      send(res, 200, { ok: true });
    });
  }

  if (url === '/api/claims' && req.method === 'GET') return send(res, 200, read('claims'));

  if (url === '/api/claims' && req.method === 'POST') {
    return body(req, (j) => {
      const questId = Number(j && j.questId);
      const name = String((j && j.name) || '').trim();
      const quest = read('quests').find(q => q.id === questId);
      if (!quest || !Array.isArray(quest.assignees) || !quest.assignees.some(a => (a || '').toLowerCase() === name.toLowerCase())) {
        return send(res, 400, { error: 'invalid' });
      }
      const claims = read('claims');
      if (claims.some(c => c.questId === questId && (c.name || '').toLowerCase() === name.toLowerCase() && c.status !== 'rejected'))
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
    return send(res, 200, getUserBalance(name));
  }

  if (url === '/api/customers/balances' && req.method === 'GET') {
    const reqs = read('requests').filter(r => r.status === 'approved' || !r.status);
    const names = [...new Set(reqs.map(r => r.name))];
    const list = names.map(name => ({
      name,
      credit: getUserBalance(name).credit
    }));
    return send(res, 200, list);
  }

  if (url === '/api/trades' && req.method === 'GET') {
    const user = (new URL(req.url, 'http://x').searchParams.get('user') || '').trim().toLowerCase();
    let list = read('trades');
    if (user) {
      list = list.filter(t => (t.fromUser || '').toLowerCase() === user || (t.toUser || '').toLowerCase() === user);
    }
    list.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
    return send(res, 200, list);
  }

  if (url === '/api/trades' && req.method === 'POST') {
    return body(req, (j) => {
      const fromUser = String((j && j.fromUser) || '').trim();
      const toUser = String((j && j.toUser) || '').trim();
      const amount = Math.max(1, Math.floor(Number(j && j.amount) || 0));
      const note = String((j && j.note) || '').trim().slice(0, 200);
      const isDirect = Boolean(j && j.direct);

      if (!fromUser || !toUser) {
        return send(res, 400, { error: 'กรุณาเลือกทั้งผู้โอนและผู้รับ' });
      }
      if (fromUser.toLowerCase() === toUser.toLowerCase()) {
        return send(res, 400, { error: 'ผู้โอนและผู้รับต้องไม่ใช่คนเดียวกัน' });
      }
      if (!amount || amount <= 0) {
        return send(res, 400, { error: 'จำนวนเครดิตต้องมากกว่า 0' });
      }

      const balInfo = getUserBalance(fromUser);
      if (isDirect) {
        if (balInfo.credit < amount) {
          return send(res, 400, {
            error: 'เครดิตของผู้โอนไม่เพียงพอ (มี 🪙 ' + balInfo.credit + ' แต่ต้องการโอน 🪙 ' + amount + ')'
          });
        }
      } else {
        if (balInfo.availableCredit < amount) {
          return send(res, 400, {
            error: 'เครดิตที่ใช้เทรดได้ไม่เพียงพอ (คงเหลือ 🪙 ' + balInfo.credit + ', อยู่ระหว่างรออนุมัติ 🪙 ' + balInfo.pendingTradeOut + ', ใช้ได้ 🪙 ' + balInfo.availableCredit + ')'
          });
        }
      }

      const trade = {
        id: Date.now(),
        fromUser,
        toUser,
        amount,
        note,
        status: isDirect ? 'approved' : 'pending',
        createdBy: isDirect ? 'admin' : fromUser,
        cancelled: false,
        time: new Date().toISOString()
      };

      const trades = read('trades');
      trades.push(trade);
      write('trades', trades);

      const msgs = read('messages');
      const nowIso = new Date().toISOString();
      const noteTxt = note ? ' (หมายเหตุ: ' + note + ')' : '';

      if (isDirect) {
        msgs.push({
          id: Date.now() + 1,
          user: fromUser,
          fromAdmin: true,
          text: '🔄 แอดมินได้โอนเครดิต 🪙 ' + amount + ' จากคุณไปยัง "' + toUser + '" เรียบร้อยแล้ว' + noteTxt,
          readByAdmin: true,
          readByUser: false,
          time: nowIso
        });
        msgs.push({
          id: Date.now() + 2,
          user: toUser,
          fromAdmin: true,
          text: '🔄 คุณได้รับโอนเครดิต 🪙 ' + amount + ' จาก "' + fromUser + '" เรียบร้อยแล้ว!' + noteTxt,
          readByAdmin: true,
          readByUser: false,
          time: nowIso
        });
      } else {
        msgs.push({
          id: Date.now() + 1,
          user: fromUser,
          fromAdmin: true,
          text: '🔄 คุณได้ส่งคำขอเทรดเครดิต 🪙 ' + amount + ' ให้ "' + toUser + '" แล้ว (รอแอดมินอนุมัติ)' + noteTxt,
          readByAdmin: true,
          readByUser: false,
          time: nowIso
        });
      }
      write('messages', msgs);

      return send(res, 201, { ok: true, trade });
    });
  }

  if (url === '/api/trades/decide' && req.method === 'POST') {
    return body(req, (j) => {
      const tradeId = j && j.id;
      const decision = j && j.status;
      if (decision !== 'approved' && decision !== 'rejected') {
        return send(res, 400, { error: 'bad decision status' });
      }

      const trades = read('trades');
      const trade = trades.find(t => String(t.id) === String(tradeId));
      if (!trade) return send(res, 404, { error: 'ไม่พบคำขอเทรดนี้' });
      if (trade.status !== 'pending') {
        return send(res, 400, { error: 'คำขอนี้ได้รับการตัดสินไปแล้ว (' + trade.status + ')' });
      }

      if (decision === 'approved') {
        const senderBal = getUserBalance(trade.fromUser).credit;
        if (senderBal < trade.amount) {
          return send(res, 400, {
            error: 'เครดิตของผู้โอน (' + trade.fromUser + ') ปัจจุบันมีเพียง 🪙 ' + senderBal + ' ไม่พอโอน 🪙 ' + trade.amount
          });
        }
      }

      trade.status = decision;
      trade.decidedAt = new Date().toISOString();
      write('trades', trades);

      const msgs = read('messages');
      const nowIso = new Date().toISOString();
      const noteTxt = trade.note ? ' (หมายเหตุ: ' + trade.note + ')' : '';

      if (decision === 'approved') {
        msgs.push({
          id: Date.now() + 1,
          user: trade.fromUser,
          fromAdmin: true,
          text: '✓ แอดมินอนุมัติคำขอเทรดเครดิต 🪙 ' + trade.amount + ' ให้ "' + trade.toUser + '" เรียบร้อยแล้ว!' + noteTxt,
          readByAdmin: true,
          readByUser: false,
          time: nowIso
        });
        msgs.push({
          id: Date.now() + 2,
          user: trade.toUser,
          fromAdmin: true,
          text: '🔄 คุณได้รับโอนเครดิต 🪙 ' + trade.amount + ' จาก "' + trade.fromUser + '" (แอดมินอนุมัติแล้ว)' + noteTxt,
          readByAdmin: true,
          readByUser: false,
          time: nowIso
        });
      } else {
        msgs.push({
          id: Date.now() + 1,
          user: trade.fromUser,
          fromAdmin: true,
          text: '❌ คำขอเทรดเครดิต 🪙 ' + trade.amount + ' ให้ "' + trade.toUser + '" ถูกปฏิเสธโดยแอดมิน',
          readByAdmin: true,
          readByUser: false,
          time: nowIso
        });
      }
      write('messages', msgs);

      return send(res, 200, { ok: true, trade });
    });
  }

  if (url === '/api/trades/cancel' && req.method === 'POST') {
    return body(req, (j) => {
      const tradeId = j && j.id;
      const user = String((j && j.user) || '').trim();
      const trades = read('trades');
      const trade = trades.find(t => String(t.id) === String(tradeId));
      if (!trade) return send(res, 404, { error: 'ไม่พบคำขอนี้' });
      if (trade.status !== 'pending') {
        return send(res, 400, { error: 'ไม่สามารถยกเลิกคำขอที่ดำเนินการแล้วได้' });
      }
      if (user && trade.fromUser !== user) {
        return send(res, 403, { error: 'คุณไม่ใช่ผู้ส่งคำขอนี้' });
      }

      trade.status = 'cancelled';
      trade.cancelled = true;
      trade.cancelledAt = new Date().toISOString();
      write('trades', trades);

      return send(res, 200, { ok: true, trade });
    });
  }

  if (url === '/api/trades/rollback' && req.method === 'POST') {
    return body(req, (j) => {
      const tradeId = j && j.id;
      const trades = read('trades');
      const trade = trades.find(t => String(t.id) === String(tradeId));
      if (!trade) return send(res, 404, { error: 'ไม่พบรายการเทรด' });
      if (trade.cancelled || trade.status === 'cancelled') {
        return send(res, 400, { error: 'รายการนี้ถูกยกเลิกไปแล้ว' });
      }
      if (trade.status !== 'approved' && trade.status) {
        return send(res, 400, { error: 'เฉพาะรายการที่อนุมัติแล้วเท่านั้นที่ย้อนคืนได้' });
      }

      const recBal = getUserBalance(trade.toUser).credit;
      if (recBal < trade.amount) {
        return send(res, 400, {
          error: 'ผู้รับ (' + trade.toUser + ') มีเครดิตเหลือเพียง 🪙 ' + recBal + ' ไม่เพียงพอที่จะคืน 🪙 ' + trade.amount
        });
      }

      trade.cancelled = true;
      trade.status = 'cancelled';
      trade.cancelledAt = new Date().toISOString();
      write('trades', trades);

      const msgs = read('messages');
      const nowIso = new Date().toISOString();
      msgs.push({
        id: Date.now() + 1,
        user: trade.fromUser,
        fromAdmin: true,
        text: '↩️ แอดมินได้ยกเลิกการโอนเครดิต 🪙 ' + trade.amount + ' ให้ "' + trade.toUser + '" และคืนเครดิตเข้าบัญชีคุณเรียบร้อยแล้ว',
        readByAdmin: true,
        readByUser: false,
        time: nowIso
      });
      msgs.push({
        id: Date.now() + 2,
        user: trade.toUser,
        fromAdmin: true,
        text: '↩️ การโอนเครดิต 🪙 ' + trade.amount + ' จาก "' + trade.fromUser + '" ถูกยกเลิกโดยแอดมิน',
        readByAdmin: true,
        readByUser: false,
        time: nowIso
      });
      write('messages', msgs);

      return send(res, 200, { ok: true, trade });
    });
  }

  if (url === '/api/gifts' && req.method === 'GET') {
    const user = (new URL(req.url, 'http://x').searchParams.get('user') || '').trim().toLowerCase();
    const all = read('gifts');
    if (!user) return send(res, 200, all);
    return send(res, 200, all.filter(g => Array.isArray(g.recipients) && g.recipients.some(r => (r || '').toLowerCase() === user)));
  }

  if (url === '/api/gifts' && req.method === 'POST') {
    return body(req, (j) => {
      const title = String((j && j.title) || '').trim().slice(0, 100);
      const desc = String((j && j.desc) || '').trim().slice(0, 500);
      const credit = Math.floor(Number(j && j.credit) || 0);
      const recipients = Array.isArray(j && j.recipients)
        ? j.recipients.map(a => String(a).slice(0, 60)).slice(0, 200) : [];
      if (!title) return send(res, 400, { error: 'title required' });
      if (!recipients.length) return send(res, 400, { error: 'recipients required' });
      const list = read('gifts');
      const item = { id: Date.now(), title, desc, credit, recipients, time: new Date().toISOString() };
      list.push(item);
      write('gifts', list);

      // Send chat notification to each recipient
      const msgs = read('messages');
      recipients.forEach(name => {
        const creditText = credit < 0 ? '(-🪙 ' + Math.abs(credit) + ' เครดิต)' : '(+🪙 ' + credit + ' เครดิต)';
        const giftPrefix = credit < 0 ? '⚠️ รายการปรับลดเครดิตจากผู้ดูแล: "' : '🎁 คุณได้รับของขวัญจากผู้ดูแล: "';
        msgs.push({
          id: Date.now() + Math.floor(Math.random() * 1000),
          user: name,
          sender: 'admin',
          text: giftPrefix + title + '" ' + creditText + (desc ? ' - ' + desc : ''),
          time: new Date().toISOString(),
          read: false
        });
      });
      write('messages', msgs);

      send(res, 201, { ok: true, gift: item });
    });
  }

  if (url === '/api/gifts/delete' && req.method === 'POST') {
    return body(req, (j) => {
      const id = Number(j && j.id);
      if (!id) return send(res, 400, { error: 'id required' });
      let list = read('gifts');
      list = list.filter(x => x.id !== id);
      write('gifts', list);
      send(res, 200, { ok: true });
    });
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

  if (url === '/api/shop/items/update' && req.method === 'POST') {
    return body(req, (j) => {
      const id = Number(j && j.id);
      const title = String((j && j.title) || '').trim().slice(0, 100);
      const desc = String((j && j.desc) || '').trim().slice(0, 500);
      const credit = Math.max(1, Math.floor(Number(j && j.credit) || 0));
      const stock = Math.max(0, Math.floor(Number(j && j.stock) || 0));
      const icon = String((j && j.icon) || '🎁').trim().slice(0, 10);
      if (!id || !title || !credit) return send(res, 400, { error: 'id, title, and credit required' });
      const list = readShop();
      const item = list.find(x => x.id === id);
      if (!item) return send(res, 404, { error: 'item not found' });
      item.title = title;
      item.desc = desc;
      item.credit = credit;
      item.stock = stock;
      item.icon = icon || '🎁';
      item.updatedAt = new Date().toISOString();
      write('shop', list);
      send(res, 200, { ok: true, item });
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

      const userBal = getUserBalance(user).credit;

      if (userBal < item.credit) {
        return send(res, 400, {
          error: 'insufficient_credit',
          message: 'เครดิตไม่เพียงพอ (ต้องการ 🪙 ' + item.credit + ' แต่คุณมี 🪙 ' + userBal + ')'
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
    const user = (new URL(req.url, 'http://x').searchParams.get('user') || '').trim().toLowerCase();
    const all = read('redemptions');
    if (!user) return send(res, 200, all);
    return send(res, 200, all.filter(r => (r.user || '').toLowerCase() === user));
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

  if (url === '/api/wishes' && req.method === 'GET') {
    return send(res, 200, read('wishes'));
  }

  if (url === '/api/wishes' && req.method === 'POST') {
    return body(req, (j) => {
      const title = String((j && j.title) || '').trim().slice(0, 100);
      const desc = String((j && j.desc) || '').trim().slice(0, 500);
      const user = String((j && j.user) || '').trim().slice(0, 60);
      if (!title || !user) return send(res, 400, { error: 'title and user required' });
      const list = read('wishes');
      const item = { id: Date.now(), title, desc, user, status: 'pending', time: new Date().toISOString() };
      list.push(item);
      write('wishes', list);

      // Notify in chat for admin
      const msgs = read('messages');
      msgs.push({
        id: Date.now() + Math.floor(Math.random() * 1000),
        user,
        sender: 'user',
        text: '💡 รีเควสของรางวัลใหม่: "' + title + '" ' + (desc ? '(' + desc + ')' : ''),
        time: new Date().toISOString(),
        read: false
      });
      write('messages', msgs);

      send(res, 201, { ok: true, wish: item });
    });
  }

  if (url === '/api/wishes/delete' && req.method === 'POST') {
    return body(req, (j) => {
      const id = Number(j && j.id);
      if (!id) return send(res, 400, { error: 'id required' });
      let list = read('wishes');
      list = list.filter(x => x.id !== id);
      write('wishes', list);
      send(res, 200, { ok: true });
    });
  }

  if (url === '/api/messages' && req.method === 'GET') {
    const user = (new URL(req.url, 'http://x').searchParams.get('user') || '').trim().toLowerCase();
    const all = read('messages');
    if (!user) return send(res, 200, all);
    const filtered = all.filter(m => 
      (m.user || '').toLowerCase() === user || 
      (m.from || '').toLowerCase() === user || 
      (m.to || '').toLowerCase() === user
    );
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

  if ((url === '/api/sync/customer' || url === '/api/sync/customer-restore') && req.method === 'POST') {
    return body(req, (j) => {
      const name = String((j && j.name) || '').trim().slice(0, 60);
      const username = String((j && (j.username || j.name)) || '').trim().slice(0, 60);
      const password = String((j && j.password) || '').trim().slice(0, 60);
      const status = (j && j.status) === 'rejected' ? 'rejected' : 'approved';
      if (!name) return send(res, 400, { error: 'name required' });

      // 1. Account / Request sync
      const list = read('requests');
      let r = list.find(x => 
        (x.name && x.name.toLowerCase() === name.toLowerCase()) ||
        (x.username && x.username.toLowerCase() === username.toLowerCase())
      );
      if (!r) {
        r = {
          id: Date.now(),
          name,
          username,
          password: password || '1234',
          status,
          time: new Date().toISOString(),
          restored: true
        };
        list.push(r);
        write('requests', list);
      } else {
        if (!r.username) r.username = username;
        if (!r.password && password) r.password = password;
        write('requests', list);
      }

      // 2. Restore quests if provided and missing on server
      if (Array.isArray(j && j.quests) && j.quests.length) {
        const curQuests = read('quests');
        const curQuestIds = new Set(curQuests.map(x => String(x.id)));
        let qAdded = 0;
        j.quests.forEach(q => {
          if (q && q.title && !curQuestIds.has(String(q.id))) {
            curQuests.push(q);
            curQuestIds.add(String(q.id));
            qAdded++;
          }
        });
        if (qAdded > 0) write('quests', curQuests);
      }

      // 3. Restore claims if provided and missing on server
      if (Array.isArray(j && j.claims) && j.claims.length) {
        const curClaims = read('claims');
        const curClaimIds = new Set(curClaims.map(x => String(x.id)));
        let cAdded = 0;
        j.claims.forEach(c => {
          if (c && !curClaimIds.has(String(c.id))) {
            curClaims.push(c);
            curClaimIds.add(String(c.id));
            cAdded++;
          }
        });
        if (cAdded > 0) write('claims', curClaims);
      }

      // 4. Restore messages if provided and missing on server
      if (Array.isArray(j && j.messages) && j.messages.length) {
        const curMsgs = read('messages');
        const curMsgIds = new Set(curMsgs.map(x => String(x.id)));
        let mAdded = 0;
        j.messages.forEach(m => {
          if (m && !curMsgIds.has(String(m.id))) {
            curMsgs.push(m);
            curMsgIds.add(String(m.id));
            mAdded++;
          }
        });
        if (mAdded > 0) write('messages', curMsgs);
      }

      // 5. Restore gifts if provided and missing on server
      if (Array.isArray(j && j.gifts) && j.gifts.length) {
        const curGifts = read('gifts');
        const curGiftIds = new Set(curGifts.map(x => String(x.id)));
        let gAdded = 0;
        j.gifts.forEach(g => {
          if (g && !curGiftIds.has(String(g.id))) {
            curGifts.push(g);
            curGiftIds.add(String(g.id));
            gAdded++;
          }
        });
        if (gAdded > 0) write('gifts', curGifts);
      }

      // 6. Restore trades if provided and missing on server
      if (Array.isArray(j && j.trades) && j.trades.length) {
        const curTrades = read('trades');
        const curTradeIds = new Set(curTrades.map(x => String(x.id)));
        let tAdded = 0;
        j.trades.forEach(t => {
          if (t && !curTradeIds.has(String(t.id))) {
            curTrades.push(t);
            curTradeIds.add(String(t.id));
            tAdded++;
          }
        });
        if (tAdded > 0) write('trades', curTrades);
      }

      return send(res, 200, { ok: true, request: r });
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
      if (Array.isArray(j.gifts) && j.gifts.length) {
        const current = read('gifts');
        const currentIds = new Set(current.map(x => String(x.id)));
        let added = 0;
        j.gifts.forEach(g => {
          if (g && g.title && !currentIds.has(String(g.id))) {
            current.push(g);
            currentIds.add(String(g.id));
            added++;
          }
        });
        if (added > 0 || !current.length) write('gifts', current);
      }
      if (Array.isArray(j.wishes) && j.wishes.length) {
        const current = read('wishes');
        const currentIds = new Set(current.map(x => String(x.id)));
        let added = 0;
        j.wishes.forEach(w => {
          if (w && w.title && !currentIds.has(String(w.id))) {
            current.push(w);
            currentIds.add(String(w.id));
            added++;
          }
        });
        if (added > 0 || !current.length) write('wishes', current);
      }
      if (Array.isArray(j.trades) && j.trades.length) {
        const current = read('trades');
        const currentIds = new Set(current.map(x => String(x.id)));
        let added = 0;
        j.trades.forEach(t => {
          if (t && !currentIds.has(String(t.id))) {
            current.push(t);
            currentIds.add(String(t.id));
            added++;
          }
        });
        if (added > 0 || !current.length) write('trades', current);
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
      gifts: read('gifts'),
      wishes: read('wishes'),
      trades: read('trades'),
      exportedAt: new Date().toISOString()
    });
  }

  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
  }

  res.writeHead(404); res.end('Not found');
}).listen(PORT, '0.0.0.0', () => console.log('Running on http://localhost:' + PORT));
