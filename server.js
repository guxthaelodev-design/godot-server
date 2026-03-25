const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

console.log("✅ WebSocket server on port:", PORT);

/**
 * rooms[room_code] = {
 *   host_uid: string,
 *   host_ws: WebSocket,
 *   players: Map<WebSocket, { uid: string, nick: string, car_index: number }>
 * }
 */
let rooms = {};

function safeSend(ws, obj) {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  } catch (_) {}
}

function broadcast(room, obj, exceptWs = null) {
  for (const [pws] of room.players) {
    if (pws !== exceptWs) safeSend(pws, obj);
  }
}

function closeRoom(roomCode, reason = "host_left") {
  const room = rooms[roomCode];
  if (!room) return;

  broadcast(room, { type: "room_closed", reason });

  for (const [pws] of room.players) {
    try { pws.close(); } catch (_) {}
  }

  delete rooms[roomCode];
}

function getRoom(ws) {
  if (!ws.room_code) return null;
  return rooms[ws.room_code] || null;
}

wss.on("connection", ws => {
  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw); }
    catch { return safeSend(ws, { type: "error", code: "bad_json" }); }

    const type = msg.type;

    // CREATE ROOM (host)
    if (type === "create_room") {
      const roomCode = String(msg.room_code || "").trim();
      const uid = String(msg.uid || "").trim();
      const nick = String(msg.nick || "").trim();
      const car_index = Number(msg.car_index ?? 0);

      if (!roomCode || !uid) return safeSend(ws, { type: "error", code: "missing_room_or_uid" });
      if (rooms[roomCode]) return safeSend(ws, { type: "error", code: "room_exists" });

      rooms[roomCode] = {
        host_uid: uid,
        host_ws: ws,
        players: new Map(),
      };

      rooms[roomCode].players.set(ws, { uid, nick, car_index });

      ws.room_code = roomCode;
      ws.uid = uid;

      safeSend(ws, { type: "room_joined", room_code: roomCode, is_host: true, host_uid: uid });

      safeSend(ws, {
        type: "room_players",
        host_uid: uid,
        players: Array.from(rooms[roomCode].players.values())
      });

      return;
    }

    // JOIN ROOM (client)
    if (type === "join_room") {
      const roomCode = String(msg.room_code || "").trim();
      const uid = String(msg.uid || "").trim();
      const nick = String(msg.nick || "").trim();
      const car_index = Number(msg.car_index ?? 0);

      const room = rooms[roomCode];
      if (!room) return safeSend(ws, { type: "error", code: "room_not_found" });
      if (!uid) return safeSend(ws, { type: "error", code: "missing_uid" });

      for (const [, p] of room.players) {
        if (p.uid === uid) return safeSend(ws, { type: "error", code: "uid_already_in_room" });
      }

      room.players.set(ws, { uid, nick, car_index });

      ws.room_code = roomCode;
      ws.uid = uid;

      safeSend(ws, { type: "room_joined", room_code: roomCode, is_host: false, host_uid: room.host_uid });

      broadcast(room, { type: "player_joined", uid, nick, car_index }, ws);

      safeSend(ws, {
        type: "room_players",
        host_uid: room.host_uid,
        players: Array.from(room.players.values())
      });

      return;
    }

    const room = getRoom(ws);
    if (!room) return safeSend(ws, { type: "error", code: "not_in_room" });

    // START GAME (somente host)
    if (type === "start_game") {
      if (ws !== room.host_ws) return safeSend(ws, { type: "error", code: "only_host_can_start" });
      broadcast(room, { type: "game_started" });
      return;
    }

    // player move (repasse)
    if (type === "player_move") {
      broadcast(room, {
        type: "player_move",
        uid: msg.uid,
        pos: msg.pos,
        rot_y: msg.rot_y,
        car_index: msg.car_index ?? 0,
      }, ws);
      return;
    }

    // ai move (somente host)
    if (type === "ai_move") {
      if (ws !== room.host_ws) return;
      broadcast(room, {
        type: "ai_move",
        bot_id: msg.bot_id,
        pos: msg.pos,
        rot_y: msg.rot_y
      });
      return;
    }

    safeSend(ws, { type: "error", code: "unknown_type" });
  });

  ws.on("close", () => {
    const roomCode = ws.room_code;
    if (!roomCode) return;

    const room = rooms[roomCode];
    if (!room) return;

    room.players.delete(ws);

    // se era o host: fecha a sala e derruba geral
    if (ws === room.host_ws) {
      closeRoom(roomCode, "host_left");
      return;
    }

    broadcast(room, { type: "player_left", uid: ws.uid });

    if (room.players.size === 0) delete rooms[roomCode];
  });
});
