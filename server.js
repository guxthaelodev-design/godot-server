const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS_PER_ROOM = 8;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("room server online");
});

const wss = new WebSocket.Server({ server });
const rooms = new Map();

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function getRoomPlayersPayload(room) {
  return Array.from(room.players.values()).map((player) => ({
    uid: player.uid,
    nick: player.nick,
    car_index: player.car_index,
  }));
}

function broadcastRoom(room, data) {
  for (const player of room.players.values()) {
    send(player.ws, data);
  }
}

function emitRoomPlayers(room) {
  broadcastRoom(room, {
    type: "room_players",
    room_code: room.roomCode,
    room_name: room.roomName,
    players: getRoomPlayersPayload(room),
  });
}

function cleanupSocketRefs(ws) {
  ws.uid = null;
  ws.roomCode = null;
}

function removePlayerFromRoom(ws, silent = false) {
  const roomCode = ws.roomCode;
  const uid = ws.uid;

  if (!roomCode || !uid) {
    cleanupSocketRefs(ws);
    return;
  }

  const room = rooms.get(roomCode);
  if (!room) {
    cleanupSocketRefs(ws);
    return;
  }

  if (!room.players.has(uid)) {
    cleanupSocketRefs(ws);
    return;
  }

  const player = room.players.get(uid);
  room.players.delete(uid);

  if (room.hostUid === uid) {
    if (!silent) {
      broadcastRoom(room, {
        type: "room_closed",
        room_code: roomCode,
      });
    }
    rooms.delete(roomCode);
    cleanupSocketRefs(ws);
    return;
  }

  if (!silent) {
    broadcastRoom(room, {
      type: "player_left",
      room_code: roomCode,
      uid: player.uid,
      nick: player.nick,
    });

    emitRoomPlayers(room);
  }

  if (room.players.size === 0) {
    rooms.delete(roomCode);
  }

  cleanupSocketRefs(ws);
}

function socketAlreadyInAnyRoom(uid) {
  for (const room of rooms.values()) {
    if (room.players.has(uid)) {
      return true;
    }
  }
  return false;
}

wss.on("connection", (ws) => {
  ws.uid = null;
  ws.roomCode = null;

  send(ws, { type: "connected" });

  ws.on("message", (msg) => {
    let data;

    try {
      data = JSON.parse(msg.toString());
    } catch (err) {
      send(ws, { type: "error", code: "invalid_json" });
      return;
    }

    const type = String(data.type || "").trim();

    if (type === "create_room") {
      const roomCode = String(data.room_code || "").trim();
      const roomName = String(data.room_name || "").trim();
      const password = String(data.password || "").trim();
      const uid = String(data.uid || "").trim();
      const nick = String(data.nick || "").trim();
      const carIndex = Number(data.car_index || 0);

      if (!roomCode || !password || !uid || !nick) {
        send(ws, { type: "error", code: "missing_fields" });
        return;
      }

      if (rooms.has(roomCode)) {
        send(ws, { type: "error", code: "room_exists" });
        return;
      }

      if (socketAlreadyInAnyRoom(uid)) {
        send(ws, { type: "error", code: "already_in_room" });
        return;
      }

      const room = {
        roomCode,
        roomName: roomName || `Sala de ${nick}`,
        password,
        hostUid: uid,
        status: "lobby",
        players: new Map(),
      };

      room.players.set(uid, {
        uid,
        nick,
        car_index: carIndex,
        ws,
      });

      rooms.set(roomCode, room);

      ws.uid = uid;
      ws.roomCode = roomCode;

      send(ws, {
        type: "room_joined",
        room_code: roomCode,
        room_name: room.roomName,
        is_host: true,
      });

      emitRoomPlayers(room);
      return;
    }

    if (type === "join_room") {
      const roomCode = String(data.room_code || "").trim();
      const password = String(data.password || "").trim();
      const uid = String(data.uid || "").trim();
      const nick = String(data.nick || "").trim();
      const carIndex = Number(data.car_index || 0);

      if (!roomCode || !password || !uid || !nick) {
        send(ws, { type: "error", code: "missing_fields" });
        return;
      }

      const room = rooms.get(roomCode);

      if (!room) {
        send(ws, { type: "error", code: "room_not_found" });
        return;
      }

      if (room.password !== password) {
        send(ws, { type: "error", code: "wrong_password" });
        return;
      }

      if (room.status !== "lobby") {
        send(ws, { type: "error", code: "game_already_started" });
        return;
      }

      if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
        send(ws, { type: "error", code: "room_full" });
        return;
      }

      if (room.players.has(uid) || socketAlreadyInAnyRoom(uid)) {
        send(ws, { type: "error", code: "already_in_room" });
        return;
      }

      room.players.set(uid, {
        uid,
        nick,
        car_index: carIndex,
        ws,
      });

      ws.uid = uid;
      ws.roomCode = roomCode;

      send(ws, {
        type: "room_joined",
        room_code: roomCode,
        room_name: room.roomName,
        is_host: false,
      });

      broadcastRoom(room, {
        type: "player_joined",
        room_code: roomCode,
        uid,
        nick,
      });

      emitRoomPlayers(room);
      return;
    }

    if (type === "leave_room") {
      const roomCode = ws.roomCode;
      removePlayerFromRoom(ws, false);

      send(ws, {
        type: "left_room",
        room_code: roomCode || "",
      });
      return;
    }

    if (type === "start_game") {
      const roomCode = String(data.room_code || "").trim();
      const uid = String(data.uid || "").trim();

      if (!roomCode || !uid) {
        send(ws, { type: "error", code: "missing_fields" });
        return;
      }

      const room = rooms.get(roomCode);

      if (!room) {
        send(ws, { type: "error", code: "room_not_found" });
        return;
      }

      if (room.hostUid !== uid) {
        send(ws, { type: "error", code: "not_host" });
        return;
      }

      room.status = "in_game";

      broadcastRoom(room, {
        type: "game_started",
        room_code: roomCode,
        room_name: room.roomName,
        players: getRoomPlayersPayload(room),
      });
      return;
    }

    if (type === "player_move") {
      const roomCode = String(data.room_code || "").trim();
      const uid = String(data.uid || "").trim();

      if (!roomCode || !uid) {
        send(ws, { type: "error", code: "missing_fields" });
        return;
      }

      const room = rooms.get(roomCode);
      if (!room) {
        return;
      }

      if (!room.players.has(uid)) {
        return;
      }

      broadcastRoom(room, {
        type: "player_move",
        room_code: roomCode,
        uid,
        pos: data.pos || {},
        rot: data.rot || {},
        car_index: Number(data.car_index || 0),
      });
      return;
    }

    if (type === "ai_state") {
      const roomCode = String(data.room_code || "").trim();

      if (!roomCode) {
        send(ws, { type: "error", code: "missing_fields" });
        return;
      }

      const room = rooms.get(roomCode);
      if (!room) {
        return;
      }

      if (room.hostUid !== ws.uid) {
        return;
      }

      broadcastRoom(room, {
        type: "ai_state",
        room_code: roomCode,
        bot_id: String(data.bot_id || ""),
        pos: data.pos || {},
        rot: data.rot || {},
        lin: data.lin || {},
        ang: data.ang || {},
      });
      return;
    }

    send(ws, { type: "error", code: "unknown_type" });
  });

  ws.on("close", () => {
    removePlayerFromRoom(ws, false);
  });

  ws.on("error", () => {
    removePlayerFromRoom(ws, false);
  });
});

server.listen(PORT, () => {
  console.log(`room server running on port ${PORT}`);
});
