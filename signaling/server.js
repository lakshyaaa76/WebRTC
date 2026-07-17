// Phase 1: room creation/joining and SDP/ICE message relaying.
// This server only ever brokers small JSON signaling messages between exactly two
// sockets per room — it never sees or touches any file data. Room state is held
// entirely in memory for the lifetime of the process; nothing is persisted to disk.
//
// Message protocol (see project_context.md / project_phases.md for the full spec):
//
// Client -> Server
//   { type: "create-room" }
//   { type: "join-room", roomId }
//   { type: "offer", roomId, sdp }
//   { type: "answer", roomId, sdp }
//   { type: "ice-candidate", roomId, candidate }
//   { type: "leave-room", roomId }
//
// Server -> Client
//   { type: "room-created", roomId }
//   { type: "peer-joined" }
//   { type: "room-full" }
//   { type: "offer", sdp }               // relayed
//   { type: "answer", sdp }              // relayed
//   { type: "ice-candidate", candidate } // relayed
//   { type: "peer-left" }
//   { type: "error", message }

const { WebSocketServer } = require("ws");

const PORT = 8000;
const wss = new WebSocketServer({ port: PORT });

// In-memory, ephemeral room table: roomId -> array of up to 2 sockets.
// This is intentionally not persisted anywhere — rooms disappear the moment
// both peers disconnect, or if the process restarts.
const rooms = new Map();

const ROOM_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function generateRoomCode() {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

function send(socket, message) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

// Relay a message to the *other* socket in the same room (not back to the sender).
function relayToOtherPeer(roomId, senderSocket, message) {
  const sockets = rooms.get(roomId);
  if (!sockets) return;
  for (const socket of sockets) {
    if (socket !== senderSocket) {
      send(socket, message);
    }
  }
}

function removeSocketFromRooms(socket) {
  for (const [roomId, sockets] of rooms.entries()) {
    const index = sockets.indexOf(socket);
    if (index === -1) continue;

    sockets.splice(index, 1);
    console.log(`[signaling] socket left room ${roomId} (${sockets.length} remaining)`);

    if (sockets.length === 0) {
      rooms.delete(roomId);
      console.log(`[signaling] room ${roomId} deleted (empty)`);
    } else {
      for (const remaining of sockets) {
        send(remaining, { type: "peer-left" });
      }
    }
  }
}

wss.on("connection", (socket) => {
  console.log("[signaling] client connected");

  socket.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (err) {
      send(socket, { type: "error", message: "Invalid JSON" });
      return;
    }

    const { type, roomId } = message;

    switch (type) {
      case "create-room": {
        const newRoomId = generateRoomCode();
        rooms.set(newRoomId, [socket]);
        socket.currentRoomId = newRoomId;
        console.log(`[signaling] room ${newRoomId} created`);
        send(socket, { type: "room-created", roomId: newRoomId });
        break;
      }

      case "join-room": {
        const sockets = rooms.get(roomId);

        if (!sockets) {
          send(socket, { type: "error", message: "Room does not exist" });
          break;
        }

        if (sockets.length >= 2) {
          send(socket, { type: "room-full" });
          break;
        }

        sockets.push(socket);
        socket.currentRoomId = roomId;
        console.log(`[signaling] socket joined room ${roomId}`);

        for (const peerSocket of sockets) {
          send(peerSocket, { type: "peer-joined" });
        }
        break;
      }

      case "offer":
      case "answer": {
        relayToOtherPeer(roomId, socket, { type, sdp: message.sdp });
        break;
      }

      case "ice-candidate": {
        relayToOtherPeer(roomId, socket, {
          type: "ice-candidate",
          candidate: message.candidate,
        });
        break;
      }

      case "leave-room": {
        removeSocketFromRooms(socket);
        break;
      }

      default:
        send(socket, { type: "error", message: `Unknown message type: ${type}` });
    }
  });

  socket.on("close", () => {
    console.log("[signaling] client disconnected");
    removeSocketFromRooms(socket);
  });
});

console.log(`[signaling] WebSocket server listening on ws://localhost:${PORT}`);
