const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
	res.writeHead(200, { "Content-Type": "text/plain" });
	res.end("Servidor online");
});

const wss = new WebSocket.Server({ server });

let rooms = {};

function send(ws, data) {
	if (ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify(data));
	}
}

function playerList(room) {
	return room.players.map((p, index) => ({
		uid: p.uid,
		nick: p.nick,
		slot: index
	}));
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

		if (type === "create_room") {
			const { room_code, uid, nick, password } = data;

			if (rooms[room_code]) {
				send(ws, { type: "error", message: "Sala já existe" });
				return;
			}

			rooms[room_code] = {
				host: ws,
				password: password || "",
				players: [{ uid, nick, ws }]
			};

			ws.room_code = room_code;
			ws.uid = uid;

			send(ws, {
				type: "room_joined",
				room_code,
				players: playerList(rooms[room_code]),
				is_host: true
			});

			console.log("Sala criada:", room_code);
		}

		if (type === "join_room") {
			const { room_code, uid, nick, password } = data;

			if (!rooms[room_code]) {
				send(ws, { type: "error", message: "Sala não existe" });
				return;
			}

			const room = rooms[room_code];

			if ((room.password || "") !== (password || "")) {
				send(ws, { type: "error", message: "Senha incorreta" });
				return;
			}

			room.players.push({ uid, nick, ws });

			ws.room_code = room_code;
			ws.uid = uid;

			send(ws, {
				type: "room_joined",
				room_code,
				players: playerList(room),
				is_host: false
			});

			broadcast(room, {
				type: "players_updated",
				players: playerList(room)
			});

			console.log("Entrou na sala:", room_code);
		}

		if (type === "start_game") {
			const { room_code } = data;
			const room = rooms[room_code];
			if (!room) return;

			if (room.host !== ws) {
				send(ws, { type: "error", message: "Só o host inicia" });
				return;
			}

			broadcast(room, { type: "game_started" });

			console.log("Jogo iniciado:", room_code);
		}

		if (type === "player_input") {
			const { room_code } = data;
			const room = rooms[room_code];
			if (!room) return;

			send(room.host, data);
		}

		if (type === "world_state") {
			const { room_code } = data;
			const room = rooms[room_code];
			if (!room) return;

			broadcast(room, data, room.host);
		}

		if (type === "leave_room") {
			handleDisconnect(ws);
		}
	});

	ws.on("close", () => {
		handleDisconnect(ws);
	});

	function handleDisconnect(socket) {
		const room_code = socket.room_code;
		if (!room_code || !rooms[room_code]) return;

		const room = rooms[room_code];

		room.players = room.players.filter(p => p.ws !== socket);

		if (room.host === socket) {
			room.players.forEach(p => {
				send(p.ws, { type: "left_room" });
			});

			delete rooms[room_code];
			console.log("Sala fechada:", room_code);
			return;
		}

		broadcast(room, {
			type: "player_left",
			uid: socket.uid
		});

		broadcast(room, {
			type: "players_updated",
			players: playerList(room)
		});

		console.log("Player saiu:", socket.uid);
	}
});

server.listen(PORT, () => {
	console.log("Servidor rodando...");
});
