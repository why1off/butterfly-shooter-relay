
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const clients = new Map();

function makeCode() {
  for (let i = 0; i < 100; i++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    if (!rooms.has(code)) return code;
  }
  throw new Error('Не удалось создать комнату');
}

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function removeClient(ws) {
  const client = clients.get(ws);
  if (!client) return;

  clients.delete(ws);

  const room = rooms.get(client.code);
  if (!room) return;

  if (client.role === 'host') {
    for (const peer of room.peers.values()) {
      send(peer.ws, { sys: 'closed' });
      peer.ws.close();
    }
    rooms.delete(client.code);
  } else {
    room.peers.delete(client.id);
    send(room.host, {
      sys: 'peer_left',
      id: client.id
    });
  }
}

// HTTP: проверка работы сервера
const server = http.createServer((req, res) => {
  console.log('HTTP REQUEST:', req.url);

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });

  res.end('Butterfly Shooter relay is running');
});

// WebSocket
const wss = new WebSocketServer({
  server,
  maxPayload: 256 * 1024
});

wss.on('connection', ws => {
  console.log('WEBSOCKET CLIENT CONNECTED');

  clients.set(ws, {
    role: null,
    code: null,
    id: null
  });

  ws.on('message', raw => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(ws, {
        sys: 'error',
        message: 'Некорректные данные'
      });
    }

    const client = clients.get(ws);
    if (!client) return;

    // Создание комнаты
    if (msg.sys === 'create') {
      if (client.role) return;

      try {
        const code = makeCode();

        const room = {
          code,
          host: ws,
          hostName: String(msg.name || 'Хост').slice(0, 14),
          map: ['neon', 'foundry'].includes(msg.map)
            ? msg.map : 'neon',
          target: [10, 15, 25, 50].includes(Number(msg.target))
            ? Number(msg.target) : 25,
          peers: new Map()
        };

        rooms.set(code, room);

        Object.assign(client, {
          role: 'host',
          code,
          id: 'host'
        });

        send(ws, {
          sys: 'created',
          code
        });

        console.log('ROOM CREATED:', code);
      } catch (error) {
        send(ws, {
          sys: 'error',
          message: error.message
        });
      }

      return;
    }

    // Подключение к комнате
    if (msg.sys === 'join') {
      if (client.role) return;

      const code = String(msg.code || '')
        .replace(/\D/g, '')
        .slice(0, 6);

      const room = rooms.get(code);

      if (!room || room.peers.size >= 7) {
        return send(ws, {
          sys: 'error',
          message: 'Комната не найдена или заполнена'
        });
      }

      const id = 'p' + Math.random().toString(36).slice(2, 10);
      const name = String(msg.name || 'Игрок').slice(0, 14);

      Object.assign(client, {
        role: 'guest',
        code,
        id
      });

      room.peers.set(id, {
        ws,
        name
      });

      send(ws, {
        sys: 'joined',
        id,
        hostName: room.hostName,
        map: room.map,
        target: room.target
      });

      send(room.host, {
        sys: 'peer_join',
        id,
        name
      });

      console.log('PLAYER JOINED:', code, id);
      return;
    }

    if (!client.role) {
      return send(ws, {
        sys: 'error',
        message: 'Сначала создайте комнату или войдите по коду'
      });
    }

    const room = rooms.get(client.code);

    if (!room) {
      return send(ws, {
        sys: 'error',
        message: 'Комната уже закрыта'
      });
    }

    // Передача игровых сообщений
    if (msg.sys === 'send') {
      if (client.role === 'host') {
        const peer = room.peers.get(String(msg.to));

        if (peer) {
          send(peer.ws, {
            sys: 'data',
            from: 'host',
            data: msg.data
          });
        }
      } else {
        send(room.host, {
          sys: 'data',
          from: client.id,
          data: msg.data
        });
      }

      return;
    }

    // Удаление игрока
    if (msg.sys === 'kick' && client.role === 'host') {
      const id = String(msg.id);
      const peer = room.peers.get(id);

      if (peer) {
        send(peer.ws, { sys: 'closed' });
        peer.ws.close();
        room.peers.delete(id);
      }

      return;
    }

    if (msg.sys === 'leave') {
      removeClient(ws);
      ws.close();
    }
  });

  ws.on('close', () => removeClient(ws));
  ws.on('error', error => {
    console.log('WEBSOCKET ERROR:', error.message);
    removeClient(ws);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Relay listening on ' + PORT);
});
