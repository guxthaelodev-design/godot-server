const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.end("Servidor online");
});

const wss = new WebSocket.Server({ server });

let rooms = {};

wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    let data = JSON.parse(msg);

    if (data.type === "join") {
      if (!rooms[data.room]) rooms[data.room] = [];

      rooms[data.room].push(ws);
      console.log("Player entrou:", data.room);
    }
  });
});

server.listen(PORT, () => {
  console.log("Servidor rodando");
});