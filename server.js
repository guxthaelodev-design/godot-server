const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });

let rooms = {}; 
// rooms = {
//   room_code: {
//     host: ws,
//     players: [{ uid, nick, ws }]
//   }
// }

function send(ws, data) {
	if (ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify(data));
	}
}

function broadcast(room, data, except_ws = null) {
	room.players.forEach(p => {
		if (p.ws !== except_ws) {
			send(p.ws, data);
		}
	});
}

wss.on("connection", (ws) => {
	console.log("Novo cliente conectado");

	ws.on("message", (message) => {
		let data;
		try {
			data = JSON.parse(message);
		} catch (e) {
			return;
		}

		const type = data.type;

		// =========================
		// CREATE ROOM
		// =========================
		if (type === "create_room") {
			const { room_code, uid, nick } = data;

			rooms[room_code] = {
				host: ws,
				players: [{ uid, nick, ws }]
			};

			ws.room_code = room_code;
			ws.uid = uid;

			send(ws, {
				type: "room_joined",
				room_code,
				players: rooms[room_code].players.map(p => ({
					uid: p.uid,
					nick: p.nick
				})),
				is_host: true
			});

			console.log("Sala criada:", room_code);
		}

		// =========================
		// JOIN ROOM
		// =========================
		if (type === "join_room") {
			const { room_code, uid, nick } = data;

			if (!rooms[room_code]) {
				send(ws, { type: "error", message: "Sala não existe" });
				return;
			}

			const room = rooms[room_code];

			room.players.push({ uid, nick, ws });

			ws.room_code = room_code;
			ws.uid = uid;

			// responde pro player que entrou
			send(ws, {
				type: "room_joined",
				room_code,
				players: room.players.map(p => ({
					uid: p.uid,
					nick: p.nick
				})),
				is_host: false
			});

			// atualiza todos
			broadcast(room, {
				type: "players_updated",
				players: room.players.map(p => ({
					uid: p.uid,
					nick: p.nick
				}))
			});

			console.log("Entrou na sala:", room_code);
		}

		// =========================
		// START GAME
		// =========================
		if (type === "start_game") {
			const { room_code } = data;

			const room = rooms[room_code];
			if (!room) return;

			broadcast(room, { type: "game_started" });

			console.log("Jogo iniciado:", room_code);
		}

		// =========================
		// INPUT → HOST
		// =========================
		if (type === "player_input") {
			const { room_code } = data;
			const room = rooms[room_code];
			if (!room) return;

			// manda só pro host
			send(room.host, data);
		}

		// =========================
		// WORLD STATE → CLIENTES
		// =========================
		if (type === "world_state") {
			const { room_code } = data;
			const room = rooms[room_code];
			if (!room) return;

			// host manda pra todos menos ele
			broadcast(room, data, room.host);
		}

		// =========================
		// LEAVE ROOM
		// =========================
		if (type === "leave_room") {
			handleDisconnect(ws);
		}
	});

	ws.on("close", () => {
		handleDisconnect(ws);
	});

	function handleDisconnect(ws) {
		const room_code = ws.room_code;
		if (!room_code || !rooms[room_code]) return;

		const room = rooms[room_code];

		// remove player
		room.players = room.players.filter(p => p.ws !== ws);

		// se era host → fecha sala
		if (room.host === ws) {
			room.players.forEach(p => {
				send(p.ws, { type: "left_room" });
			});

			delete rooms[room_code];
			console.log("Sala fechada:", room_code);
			return;
		}

		// atualiza lista
		broadcast(room, {
			type: "player_left",
			uid: ws.uid
		});

		console.log("Player saiu:", ws.uid);
	}
});

console.log("Servidor rodando...");
