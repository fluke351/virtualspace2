const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const games = require('./games');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Game state
let players = {};
// Store data per map/room
let mapsData = {};

function getMapData(id) {
  if (!mapsData[id]) mapsData[id] = { chat: [], wb: [] };
  return mapsData[id];
}

let currentVideoId = null;
let nextPlayerId = 1;

// Meeting Rooms State
function createMeetingRoomState() {
  return {
    users: [],
    password: '',
    screenSharer: null,
    ttt: games.createTttState(),
    poll: null,
  };
}

let meetingRooms = {
  room1: createMeetingRoomState(),
  room2: createMeetingRoomState(),
  room3: createMeetingRoomState(),
  room4: createMeetingRoomState(),
};

// WebSocket connection handler
const INTERVAL = 30000;

function heartbeat() {
  this.isAlive = true;
}

wss.on('connection', (ws) => {
  let playerId = null;
  let playerData = null;

  ws.isAlive = true;
  ws.on('pong', heartbeat);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'join':
          // New player joins
          playerId = String(nextPlayerId++);
          ws.playerId = playerId;  // Store playerId on WebSocket for relay purposes
          const mapId = data.mapId || 'office';
          playerData = {
            id: playerId,
            name: data.name,
            color: data.color, // Shirt color
            pants: data.pants || '#334155',
            skin: data.skin || '#ffdbac',
            accessory: data.accessory || 'none',
            hairstyle: data.hairstyle || 'none',
            hairColor: data.hairColor || '#2c2c2c',
            gender: data.gender || 'male',
            x: data.x || 0,
            y: data.y || 0,
            dir: 2,
            frame: 0,
            roomId: null, // Track current room
            mapId: mapId, // Current map
          };
          players[playerId] = playerData;

          // Filter players for current map
          const mapPlayers = {};
          Object.entries(players).forEach(([id, p]) => {
            if (p.mapId === mapId) mapPlayers[id] = p;
          });

          // Get Map Data
          const mData = getMapData(mapId);

          // Send init to new player with all existing data
          ws.send(
            JSON.stringify({
              type: 'init',
              id: playerId,
              players: mapPlayers,
              chatHistory: mData.chat,
              wbStrokes: mData.wb,
              currentVideoId: currentVideoId,
              meetingRooms: getRoomStatus(),
            })
          );

          // Broadcast new player to everyone else in map
          broadcastToMap(mapId,
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
            if (data.isMicOn !== undefined) playerData.isMicOn = data.isMicOn;
            // Add ID to the broadcast message so clients know who moved
            data.id = playerId;
            broadcastToMap(playerData.mapId, data, ws);
          }
          break;

        case 'chat':
          if (playerData) {
            const msg = {
              name: playerData.name,
              color: playerData.color,
              text: data.text,
              type: data.msgType || 'normal',
              msgType: data.msgType || 'normal', // backwards compatibility
            };
            const md = getMapData(playerData.mapId);
            md.chat.push(msg);
            if (md.chat.length > 50) md.chat.shift();

            // Broadcast only to current map
            broadcastToMap(playerData.mapId, { type: 'chat', msg: msg }, ws);
            // Send back to sender so they see their own message
            ws.send(JSON.stringify({ type: 'chat', msg: msg }));
          }
          break;

        case 'wb_stroke':
          if (data.stroke && playerData) {
            const md = getMapData(playerData.mapId);
            md.wb.push(data.stroke);
            broadcastToMap(playerData.mapId, data, ws);
            // Send back to sender? No, client draws locally usually. 
            // Actually client might rely on echo if not implemented optimistically.
            // Looking at client code: drawStroke is called on 'wb_stroke'. 
            // Client usually draws immediately? No, client code doesn't show optimistic drawing for `wb_stroke` send.
            // Let's check client code later. For now, broadcastToMap excludes sender by default in my implementation below?
            // Wait, broadcastToMap implementation:
            // if (senderWs === null || client !== senderWs)
            // So sender doesn't get it.
            // If client doesn't draw locally, they won't see it.
            // I should send it back to sender too or let client handle it.
            // Let's assume client needs it back OR I change broadcastToMap.
            // Standard: Client draws immediately, sends to server. Server broadcasts to others.
            // If I look at `index.html`, `drawStroke` is only called on `ws.onmessage`.
            // There is no `mousedown`/`mousemove` handler visible in the snippets I read that calls `drawStroke` directly for local drawing.
            // Wait, I missed reading the WB logic in client.
            // To be safe, I will send it to sender too or Use `broadcast` which sends to all?
            // `broadcastToMap` excludes sender.
            // I will manually send to sender.
            ws.send(JSON.stringify(data));
          }
          break;

        case 'wb_clear':
          if (playerData) {
            const md = getMapData(playerData.mapId);
            md.wb = [];
            broadcastToMap(playerData.mapId, { type: 'wb_clear' }, ws);
            ws.send(JSON.stringify({ type: 'wb_clear' }));
          }
          break;

        case 'yt_change':
          currentVideoId = data.videoId;
          broadcast(data, ws);
          break;

        case 'spotlight':
          if (playerData) {
            broadcast({ type: 'spotlight', id: playerId }, ws);
          }
          break;

        case 'sdp':
          // Relay SDP offer/answer to target peer
          if (data.to && data.sdp) {
            const targetWs = Array.from(wss.clients).find(
              client => client.playerId === data.to && client.readyState === WebSocket.OPEN
            );
            if (targetWs) {
              targetWs.send(JSON.stringify({ type: 'sdp', from: playerId, sdp: data.sdp }));
            }
          }
          break;

        case 'ice':
          // Relay ICE candidate to target peer
          if (data.to && data.candidate) {
            const targetWs = Array.from(wss.clients).find(
              client => client.playerId === data.to && client.readyState === WebSocket.OPEN
            );
            if (targetWs) {
              targetWs.send(JSON.stringify({ type: 'ice', from: playerId, candidate: data.candidate }));
            }
          }
          break;

        case 'start_share':
          if (playerData.roomId) {
            const r = meetingRooms[playerData.roomId];
            if (r) {
              if (!r.screenSharer) {
                r.screenSharer = playerId;
                broadcastToMap(playerData.roomId, { type: 'share_started', sharerId: playerId }, ws);
                ws.send(JSON.stringify({ type: 'share_confirmed' }));
              } else {
                ws.send(JSON.stringify({ type: 'share_error', message: 'มีคนแชร์หน้าจออยู่แล้ว' }));
              }
            }
          }
          break;

        case 'stop_share':
          if (playerData.roomId) {
            const r = meetingRooms[playerData.roomId];
            if (r && r.screenSharer === playerId) {
              r.screenSharer = null;
              broadcastToMap(playerData.roomId, { type: 'share_stopped' });
            }
          }
          break;

        case 'reaction':
          if (playerData && playerData.mapId) {
            const emoji = typeof data.emoji === 'string' ? data.emoji.slice(0, 8) : '';
            if (emoji) {
              broadcastToMap(playerData.mapId, { type: 'reaction', id: playerId, emoji });
            }
          }
          break;

        case 'announce':
          if (playerData && playerData.mapId) {
            const text = typeof data.text === 'string' ? data.text.slice(0, 200) : '';
            if (text) {
              broadcastToMap(playerData.mapId, { type: 'announce', id: playerId, text });
            }
          }
          break;

        case 'ttt_join':
          if (playerData && playerData.roomId) {
            const r = meetingRooms[playerData.roomId];
            if (r) {
              const role = games.tttAssignRole(r.ttt, playerId);
              ws.send(JSON.stringify({ type: 'ttt_role', role }));
              broadcastToMap(playerData.roomId, { type: 'ttt_state', state: r.ttt });
            }
          }
          break;

        case 'ttt_move':
          if (playerData && playerData.roomId) {
            const r = meetingRooms[playerData.roomId];
            if (r) {
              const res = games.tttMove(r.ttt, playerId, data.index);
              if (!res.ok) {
                ws.send(JSON.stringify({ type: 'ttt_error', message: res.error }));
              } else {
                broadcastToMap(playerData.roomId, { type: 'ttt_state', state: r.ttt });
              }
            }
          }
          break;

        case 'ttt_reset':
          if (playerData && playerData.roomId) {
            const r = meetingRooms[playerData.roomId];
            if (r) {
              r.ttt = games.tttReset(r.ttt);
              broadcastToMap(playerData.roomId, { type: 'ttt_state', state: r.ttt });
            }
          }
          break;

        case 'poll_create':
          if (playerData && playerData.roomId) {
            const r = meetingRooms[playerData.roomId];
            const question = typeof data.question === 'string' ? data.question.trim().slice(0, 120) : '';
            const options = Array.isArray(data.options) ? data.options.map(o => (typeof o === 'string' ? o.trim().slice(0, 60) : '')).filter(Boolean) : [];
            if (r) {
              if (!question || options.length < 2 || options.length > 4) {
                ws.send(JSON.stringify({ type: 'poll_error', message: 'โพลต้องมีคำถาม และตัวเลือก 2-4 ข้อ' }));
              } else {
                r.poll = games.createPollState(question, options, playerId);
                broadcastToMap(playerData.roomId, { type: 'poll_state', poll: r.poll, counts: games.pollResults(r.poll) });
              }
            }
          }
          break;

        case 'poll_vote':
          if (playerData && playerData.roomId) {
            const r = meetingRooms[playerData.roomId];
            if (r && r.poll) {
              const res = games.pollVote(r.poll, playerId, data.optionIndex);
              if (!res.ok) {
                ws.send(JSON.stringify({ type: 'poll_error', message: res.error }));
              } else {
                broadcastToMap(playerData.roomId, { type: 'poll_state', poll: r.poll, counts: games.pollResults(r.poll) });
              }
            }
          }
          break;

        case 'poll_close':
          if (playerData && playerData.roomId) {
            const r = meetingRooms[playerData.roomId];
            if (r && r.poll && r.poll.creatorId === playerId) {
              r.poll.open = false;
              broadcastToMap(playerData.roomId, { type: 'poll_state', poll: r.poll, counts: games.pollResults(r.poll) });
            }
          }
          break;

        case 'join_room':
          const rId = data.roomId;
          const pwd = data.password;
          const room = meetingRooms[rId];

          if (room) {
            // Check password if room has users and password is set
            if (room.users.length > 0 && room.password && room.password !== pwd) {
              ws.send(JSON.stringify({ type: 'room_error', message: 'รหัสผ่านไม่ถูกต้อง' }));
            } else {
              // Set password if room is empty
              if (room.users.length === 0) {
                room.password = pwd || '';
              }

              if (!room.users.includes(playerId)) {
                // Leave current map
                broadcastToMap(playerData.mapId, { type: 'player_leave', id: playerId });

                room.users.push(playerId);
                playerData.roomId = rId;
                playerData.mapId = rId; // Switch map to room ID
                playerData.x = 20 * 32; // Center of room
                playerData.y = 14 * 32;

                // Join room map
                broadcastToMap(rId, { type: 'player_join', id: playerId, player: playerData }, ws);
              }

              ws.send(JSON.stringify({ type: 'room_joined', roomId: rId, isHost: room.users.length === 1 }));

              // Send map data
              const mapPlayers = {};
              Object.entries(players).forEach(([id, p]) => {
                if (p.mapId === rId && id !== playerId) mapPlayers[id] = p;
              });

              // Get Room Data
              const rData = getMapData(rId);

              ws.send(JSON.stringify({
                type: 'map_changed',
                mapId: rId,
                players: mapPlayers,
                x: 20 * 32, y: 18 * 32, // Spawn below the table
                chatHistory: rData.chat,
                wbStrokes: rData.wb
              }));

              ws.send(JSON.stringify({ type: 'share_state', sharerId: room.screenSharer }));
              ws.send(JSON.stringify({ type: 'ttt_state', state: room.ttt }));
              ws.send(JSON.stringify({ type: 'poll_state', poll: room.poll, counts: room.poll ? games.pollResults(room.poll) : null }));

              broadcastRoomUpdate();
              broadcast({ type: 'player_room_update', id: playerId, roomId: rId });
            }
          }
          break;

        case 'leave_room':
          if (playerData && playerData.roomId) {
            const rId = playerData.roomId;
            const r = meetingRooms[rId];
            if (r) {
              if (r.screenSharer === playerId) {
                r.screenSharer = null;
                broadcastToMap(rId, { type: 'share_stopped' });
              }
              if (r.ttt && r.ttt.xPlayerId === playerId) r.ttt.xPlayerId = null;
              if (r.ttt && r.ttt.oPlayerId === playerId) r.ttt.oPlayerId = null;
              r.users = r.users.filter(id => id !== playerId);
              if (r.users.length === 0) {
                r.password = '';
                r.screenSharer = null;
                r.ttt = games.createTttState();
                r.poll = null;
              }
              broadcastToMap(rId, { type: 'ttt_state', state: r.ttt });
              broadcastToMap(rId, { type: 'poll_state', poll: r.poll, counts: r.poll ? games.pollResults(r.poll) : null });
            }

            // Leave room map
            broadcastToMap(rId, { type: 'player_leave', id: playerId });

            playerData.roomId = null;
            playerData.mapId = 'office';

            // Determine exit position
            let exitY = 10 * 32;
            if (rId === 'room2') exitY = 14 * 32;
            else if (rId === 'room3') exitY = 18 * 32;
            else if (rId === 'room4') exitY = 22 * 32;

            playerData.x = 34 * 32; // Step out a bit
            playerData.y = exitY;

            // Join office map
            broadcastToMap('office', { type: 'player_join', id: playerId, player: playerData }, ws);

            ws.send(JSON.stringify({ type: 'room_left' }));

            const mapPlayers = {};
            Object.entries(players).forEach(([id, p]) => {
              if (p.mapId === 'office' && id !== playerId) mapPlayers[id] = p;
            });

            // Get office data
            const officeData = getMapData('office');

            ws.send(JSON.stringify({
              type: 'map_changed',
              mapId: 'office',
              players: mapPlayers,
              x: playerData.x, y: playerData.y,
              chatHistory: officeData.chat,
              wbStrokes: officeData.wb
            }));

            broadcastRoomUpdate();
            broadcast({ type: 'player_room_update', id: playerId, roomId: null });
          }
          break;

        case 'change_map':
          if (playerData) {
            const oldMapId = playerData.mapId;
            const newMapId = data.mapId;

            if (oldMapId !== newMapId) {
              // Leave meeting room if in one
              if (playerData.roomId) {
                const r = meetingRooms[playerData.roomId];
                if (r) {
                  if (r.screenSharer === playerId) {
                    r.screenSharer = null;
                    broadcastToMap(playerData.roomId, { type: 'share_stopped' });
                  }
                  if (r.ttt && r.ttt.xPlayerId === playerId) r.ttt.xPlayerId = null;
                  if (r.ttt && r.ttt.oPlayerId === playerId) r.ttt.oPlayerId = null;
                  r.users = r.users.filter(id => id !== playerId);
                  if (r.users.length === 0) {
                    r.password = '';
                    r.screenSharer = null;
                    r.ttt = games.createTttState();
                    r.poll = null;
                  }
                  broadcastToMap(playerData.roomId, { type: 'ttt_state', state: r.ttt });
                  broadcastToMap(playerData.roomId, { type: 'poll_state', poll: r.poll, counts: r.poll ? games.pollResults(r.poll) : null });
                }
                playerData.roomId = null;
                broadcastRoomUpdate();
              }

              // Leave old map
              broadcastToMap(oldMapId, { type: 'player_leave', id: playerId });

              // Update player map
              playerData.mapId = newMapId;
              if (data.x !== undefined) playerData.x = data.x;
              if (data.y !== undefined) playerData.y = data.y;

              // Get players in new map
              const mapPlayers = {};
              Object.entries(players).forEach(([id, p]) => {
                if (p.mapId === newMapId && id !== playerId) mapPlayers[id] = p;
              });

              // Get map data
              const mData = getMapData(newMapId);

              // Send new map data to player
              ws.send(JSON.stringify({
                type: 'map_changed',
                mapId: newMapId,
                players: mapPlayers,
                chatHistory: mData.chat,
                wbStrokes: mData.wb
              }));

              // Join new map
              broadcastToMap(newMapId, { type: 'player_join', id: playerId, player: playerData }, ws);
            }
          }
          break;
      }
    } catch (err) {
      console.error('Message parse error:', err);
    }
  });

  ws.on('close', () => {
    if (playerId && players[playerId]) {
      handleDisconnect(playerId, playerData);
    }
  });
});

// Heartbeat interval to clean up dead connections
const interval = setInterval(function ping() {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, INTERVAL);

wss.on('close', function close() {
  clearInterval(interval);
});

function handleDisconnect(playerId, playerData) {
  if (!playerId || !playerData) return;

  if (playerData.roomId) {
    const r = meetingRooms[playerData.roomId];
    if (r) {
      if (r.screenSharer === playerId) {
        r.screenSharer = null;
        broadcastToMap(playerData.roomId, { type: 'share_stopped' });
      }
      if (r.ttt && r.ttt.xPlayerId === playerId) r.ttt.xPlayerId = null;
      if (r.ttt && r.ttt.oPlayerId === playerId) r.ttt.oPlayerId = null;
      r.users = r.users.filter(id => id !== playerId);
      if (r.users.length === 0) {
        r.password = '';
        r.screenSharer = null;
        r.ttt = games.createTttState();
        r.poll = null;
      }
      broadcastToMap(playerData.roomId, { type: 'ttt_state', state: r.ttt });
      broadcastToMap(playerData.roomId, { type: 'poll_state', poll: r.poll, counts: r.poll ? games.pollResults(r.poll) : null });
    }
    broadcastRoomUpdate();
  }
  const mId = playerData.mapId;
  delete players[playerId];
  broadcastToMap(mId, { type: 'player_leave', id: playerId });
}

function getRoomStatus() {
  const status = {};
  for (const id in meetingRooms) {
    status[id] = {
      count: meetingRooms[id].users.length,
      locked: !!meetingRooms[id].password
    };
  }
  return status;
}

function broadcastRoomUpdate() {
  broadcast({ type: 'room_update', rooms: getRoomStatus() });
}

function broadcastToMap(mapId, data, senderWs = null) {
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN &&
      players[client.playerId] &&
      players[client.playerId].mapId === mapId) {
      if (senderWs === null || client !== senderWs) {
        client.send(message);
      }
    }
  });
}

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
const PORT = process.env.PORT || 3805;
server.listen(PORT, () => {
  console.log(`🎮 Virtual Space Server running on http://localhost:${PORT}`);
});
