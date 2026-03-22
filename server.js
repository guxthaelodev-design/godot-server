const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Servidor online");
});

const wss = new WebSocket.Server({ server });

const rooms = new Map();

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(roomCode, data) {
  const room = rooms.get(roomCode);
  if (!room) return;

  for (const client of room.players.keys()) {
    send(client, data);
  }
}

function roomPlayerList(room) {
  const arr = [];
  for (const [, info] of room.players.entries()) {
    arr.push({ nick: info.nick });
  }
  return arr;
}

function cleanupEmptyRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  if (room.players.size === 0) {
    rooms.delete(roomCode);
    console.log("Sala deletada:", roomCode);
  }
}

wss.on("connection", (ws) => {
  console.log("Cliente conectado");

  ws.roomCode = null;
  ws.nick = null;

  send(ws, { type: "connected" });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      send(ws, { type: "error", message: "JSON inválido" });
      return;
    }

    if (msg.type === "create_room") {
      const roomCode = String(msg.room_code || "").trim();
      const password = String(msg.password || "");
      const nick = String(msg.nick || "").trim();

      if (!roomCode || !nick) {
        send(ws, { type: "error", message: "Dados inválidos" });
        return;
      }

      if (rooms.has(roomCode)) {
        send(ws, { type: "error", message: "Sala já existe" });
        return;
      }

      const room = {
        password,
        players: new Map()
      };

      room.players.set(ws, { nick });
      rooms.set(roomCode, room);

      ws.roomCode = roomCode;
      ws.nick = nick;

      send(ws, {
        type: "room_joined",
        room_code: roomCode,
        players: roomPlayerList(room),
        is_host: true
      });

      console.log("Sala criada:", roomCode, "Host:", nick);
      return;
    }

    if (msg.type === "join_room") {
      const roomCode = String(msg.room_code || "").trim();
      const password = String(msg.password || "");
      const nick = String(msg.nick || "").trim();

      const room = rooms.get(roomCode);
      if (!room) {
        send(ws, { type: "error", message: "Sala não existe" });
        return;
      }

      if (room.password !== password) {
        send(ws, { type: "error", message: "Senha incorreta" });
        return;
      }

      room.players.set(ws, { nick });
      ws.roomCode = roomCode;
      ws.nick = nick;

      send(ws, {
        type: "room_joined",
        room_code: roomCode,
        players: roomPlayerList(room),
        is_host: false
      });

      broadcast(roomCode, {
        type: "players_updated",
        players: roomPlayerList(room)
      });

      console.log("Entrou na sala:", roomCode, nick);
      return;
    }

    if (msg.type === "leave_room") {
      if (!ws.roomCode) return;

      const room = rooms.get(ws.roomCode);
      if (!room) return;

      const oldRoom = ws.roomCode;

      room.players.delete(ws);
      ws.roomCode = null;
      ws.nick = null;

      if (room.players.size > 0) {
        broadcast(oldRoom, {
          type: "players_updated",
          players: roomPlayerList(room)
        });
      }

      cleanupEmptyRoom(oldRoom);
      send(ws, { type: "left_room" });
      return;
    }
  });

  ws.on("close", () => {
    console.log("Cliente desconectado");

    if (!ws.roomCode) return;

    const room = rooms.get(ws.roomCode);
    if (!room) return;

    const oldRoom = ws.roomCode;

    room.players.delete(ws);

    if (room.players.size > 0) {
      broadcast(oldRoom, {
        type: "players_updated",
        players: roomPlayerList(room)
      });
    }

    cleanupEmptyRoom(oldRoom);
  });
});

server.listen(PORT, () => {
  console.log("Servidor rodando na porta", PORT);
});
