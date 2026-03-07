const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Game state
let players = {};
let chatHistory = [];
let wbStrokes = [];
let nextPlayerId = 1;

// WebSocket connection handler
wss.on('connection', (ws) => {
  let playerId = null;
  let playerData = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'join':
          // New player joins
          playerId = String(nextPlayerId++);
          playerData = {
            id: playerId,
            name: data.name,
            color: data.color,
            x: data.x || 0,
            y: data.y || 0,
            dir: 2,
            frame: 0,
          };
          players[playerId] = playerData;

          // Send init to new player with all existing data
          ws.send(
            JSON.stringify({
              type: 'init',
              id: playerId,
              players: players,
              chatHistory: chatHistory,
              wbStrokes: wbStrokes,
            })
          );

          // Broadcast new player to everyone else
          broadcast(
            { type: 'player_join', id: playerId, player: playerData },
            ws
          );
          break;

        case 'move':
          if (playerData) {
            playerData.x = data.x;
            playerData.y = data.y;
            playerData.dir = data.dir;
            playerData.frame = data.frame;
            broadcast(data, ws);
          }
          break;

        case 'chat':
          if (playerData) {
            const msg = {
              name: playerData.name,
              color: playerData.color,
              text: data.text,
              type: data.type || 'normal',
              msgType: data.type || 'normal', // backwards compatibility
            };
            chatHistory.push(msg);
            broadcast({ type: 'chat', msg: msg }, ws);
          }
          break;

        case 'wb_stroke':
          if (data.stroke) {
            wbStrokes.push(data.stroke);
            broadcast(data, ws);
          }
          break;

        case 'wb_clear':
          wbStrokes = [];
          broadcast({ type: 'wb_clear' }, ws);
          break;

        case 'spotlight':
          if (playerData) {
            broadcast({ type: 'spotlight', id: playerId }, ws);
          }
          break;
      }
    } catch (err) {
      console.error('Message parse error:', err);
    }
  });

  ws.on('close', () => {
    if (playerId && players[playerId]) {
      delete players[playerId];
      broadcast({ type: 'player_leave', id: playerId });
    }
  });
});

// Broadcast to all clients except sender
function broadcast(data, senderWs = null) {
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      if (senderWs === null || client !== senderWs) {
        client.send(message);
      }
    }
  });
  // Also send to sender
  if (senderWs && senderWs.readyState === WebSocket.OPEN) {
    senderWs.send(message);
  }
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Virtual Space Server running on http://localhost:${PORT}`);
});
