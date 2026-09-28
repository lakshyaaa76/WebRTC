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

// Derive the signaling server URL from the current page's hostname so that
// cross-device connections (e.g. a phone accessing the laptop via LAN IP) work
// automatically -- ws://192.168.1.7:8000 instead of ws://localhost:8000.
// An explicit NEXT_PUBLIC_SIGNALING_URL env var takes priority (used in
// production deployments pointing at a deployed wss:// server).
function getSignalingUrl(): string {
  if (process.env.NEXT_PUBLIC_SIGNALING_URL) {
    return process.env.NEXT_PUBLIC_SIGNALING_URL;
  }
  if (typeof window !== "undefined") {
    // Use the same hostname the browser used to reach the Next.js app,
    // but always talk to port 8000 (the signaling server).
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.hostname}:8000`;
  }
  return "ws://localhost:8000"; // SSR fallback (never actually used for WS)
}

const SIGNALING_URL = getSignalingUrl();

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
