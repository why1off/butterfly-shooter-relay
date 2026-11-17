const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const PORT = process.env.PORT || 3000;
const rooms = new Map();
const clients = new Map();
const alphabet = '0123456789';
function makeCode() {
  for (let n = 0; n < 100; n++) {
    let code = '';
    for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * 10)];
    if (!rooms.has(code)) return code;
  }
  throw new Error('Не удалось создать код комнаты');
}
function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function removeClient(ws) {
  const c = clients.get(ws);
  if (!c) return;
  clients.delete(ws);
  const room = rooms.get(c.code);
  if (!room) return;
  if (c.role === 'host') {
    for (const peer of room.peers.values()) send(peer.ws, { sys: 'closed' });
    rooms.delete(c.code);
  } else {
    room.peers.delete(c.id);
    send(room.host, { sys: 'peer_left', id: c.id });
    if (room.peers.size === 0 && !room.host) rooms.delete(c.code);
  }
}
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Butterfly Shooter relay is running');
  } else { res.writeHead(404); res.end('Not found'); }
});
const wss = new WebSocketServer({ server, maxPayload: 256 * 1024 });
wss.on('connection', ws => {
  console.log('WEBSOCKET CLIENT CONNECTED');
  clients.set(ws, { role: null, code: null, id: null });
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return send(ws, { sys: 'error', message: 'Некорректные данные.' }); }
    const c = clients.get(ws);
    if (!c) return;
    if (m.sys === 'create') {
      if (c.role) return;
      try {
        const code = makeCode();
        const room = { code, host: ws, hostName: String(m.name || 'Хост').slice(0, 14), map: ['neon','foundry'].includes(m.map) ? m.map : 'neon', target: [10,15,25,50].includes(Number(m.target)) ? Number(m.target) : 25, peers: new Map() };
        rooms.set(code, room); Object.assign(c, { role: 'host', code, id: 'host' });
        send(ws, { sys: 'created', code });
      } catch (e) { send(ws, { sys: 'error', message: e.message }); }
      return;
    }
    if (m.sys === 'join') {
      if (c.role) return;
      const code = String(m.code || '').replace(/\D/g, '').slice(0, 6);
      const room = rooms.get(code);
      if (!room || room.peers.size >= 7) return send(ws, { sys: 'error', message: 'Комната не найдена или уже заполнена.' });
      const id = 'p' + Math.random().toString(36).slice(2, 10);
      Object.assign(c, { role: 'guest', code, id });
      room.peers.set(id, { ws, name: String(m.name || 'Игрок').slice(0, 14) });
      send(ws, { sys: 'joined', id, hostName: room.hostName, map: room.map, target: room.target });
      send(room.host, { sys: 'peer_join', id, name: String(m.name || 'Игрок').slice(0, 14) });
      return;
    }
    if (!c.role) return send(ws, { sys: 'error', message: 'Сначала создайте комнату или войдите по коду.' });
    const room = rooms.get(c.code);
    if (!room) return send(ws, { sys: 'error', message: 'Комната уже закрыта.' });
    if (m.sys === 'send') {
      if (c.role === 'host') {
        const target = room.peers.get(String(m.to));
        if (target) send(target.ws, { sys: 'data', from: 'host', data: m.data });
      } else {
        send(room.host, { sys: 'data', from: c.id, data: m.data });
      }
    } else if (m.sys === 'kick' && c.role === 'host') {
      const peer = room.peers.get(String(m.id));
      if (peer) { send(peer.ws, { sys: 'closed' }); peer.ws.close(); room.peers.delete(String(m.id)); }
    } else if (m.sys === 'leave') {
      removeClient(ws);
      try { ws.close(); } catch {}
    }
  });
  ws.on('close', () => removeClient(ws));
  ws.on('error', () => removeClient(ws));
});
server.listen(PORT, '0.0.0.0', () => console.log(`Relay listening on ${PORT}`));
