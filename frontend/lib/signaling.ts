// Thin wrapper around the signaling WebSocket connection.
// This module only knows about the JSON message protocol defined in
// project_context.md / project_phases.md — it has no WebRTC logic in it.
// RTCPeerConnection setup is added in Phase 2 (lib/webrtc.ts), which will
// consume the callbacks registered here.

export type ServerMessage =
  | { type: "room-created"; roomId: string }
  | { type: "peer-joined" }
  | { type: "room-full" }
  | { type: "offer"; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; sdp: RTCSessionDescriptionInit }
  | { type: "ice-candidate"; candidate: RTCIceCandidateInit }
  | { type: "peer-left" }
  | { type: "error"; message: string };

type MessageHandler = (message: ServerMessage) => void;

// Defaults to the local signaling server. In later phases (deployment), this
// should be overridden via an environment variable pointing at the deployed
// wss:// URL instead of ws://localhost:8000.
const SIGNALING_URL =
  process.env.NEXT_PUBLIC_SIGNALING_URL || "ws://localhost:8000";

export class SignalingClient {
  private socket: WebSocket;
  private handlers: MessageHandler[] = [];

  constructor() {
    this.socket = new WebSocket(SIGNALING_URL);

    this.socket.addEventListener("message", (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data);
      } catch {
        console.error("[signaling] received malformed message:", event.data);
        return;
      }
      for (const handler of this.handlers) {
        handler(message);
      }
    });
  }

  onMessage(handler: MessageHandler) {
    this.handlers.push(handler);
  }

  private waitForOpen(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve) => {
      this.socket.addEventListener("open", () => resolve(), { once: true });
    });
  }

  private async send(message: Record<string, unknown>) {
    await this.waitForOpen();
    this.socket.send(JSON.stringify(message));
  }

  createRoom() {
    return this.send({ type: "create-room" });
  }

  joinRoom(roomId: string) {
    return this.send({ type: "join-room", roomId });
  }

  sendOffer(roomId: string, sdp: RTCSessionDescriptionInit) {
    return this.send({ type: "offer", roomId, sdp });
  }

  sendAnswer(roomId: string, sdp: RTCSessionDescriptionInit) {
    return this.send({ type: "answer", roomId, sdp });
  }

  sendIceCandidate(roomId: string, candidate: RTCIceCandidateInit) {
    return this.send({ type: "ice-candidate", roomId, candidate });
  }

  leaveRoom(roomId: string) {
    return this.send({ type: "leave-room", roomId });
  }

  close() {
    this.socket.close();
  }
}
