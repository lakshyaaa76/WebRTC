// Phase 2: drives the actual WebRTC handshake — SDP offer/answer, ICE candidate
// exchange, and RTCDataChannel setup — using the SignalingClient from Phase 1
// purely as a transport for the handshake messages.

import { SignalingClient, ServerMessage } from "./signaling";

// STUN is free and requires no credentials. TURN (Open Relay, via Metered.ca)
// requires signing up for a free account and fetching short-lived credentials
// via their API -- these are placeholders until that account exists. Direct
// P2P (host candidates) works fine on localhost without TURN at all.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: "turn:openrelay.metered.ca:80",
    username: process.env.NEXT_PUBLIC_TURN_USERNAME || "REPLACE_WITH_OPEN_RELAY_USERNAME",
    credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || "REPLACE_WITH_OPEN_RELAY_CREDENTIAL",
  },
];

export type PeerRole = "initiator" | "joiner";

export interface ConnectionStats {
  rttMs: number | null;
  connectionType: string | null;
  bytesPerSec: number | null;
}

export interface WebRTCConnectionCallbacks {
  onDataChannelOpen?: (channel: RTCDataChannel) => void;
  onDataChannelMessage?: (event: MessageEvent) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onStatsUpdate?: (stats: ConnectionStats) => void;
}

export class WebRTCConnection {
  private pc: RTCPeerConnection;
  private signaling: SignalingClient;
  private roomId: string;
  private role: PeerRole;
  private dataChannel: RTCDataChannel | null = null;
  private statsInterval: ReturnType<typeof setInterval> | null = null;
  private lastBytesReceived = 0;
  private lastBytesSent = 0;
  private lastStatsTime = 0;

  // ICE candidates can arrive before the offer/answer round-trip has finished
  // (they're gathered and trickled in asynchronously). Applying a candidate
  // before setRemoteDescription() has resolved throws, so early candidates are
  // queued here and flushed once the remote description is set.
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet = false;

  private callbacks: WebRTCConnectionCallbacks;

  constructor(
    signaling: SignalingClient,
    roomId: string,
    role: PeerRole,
    callbacks: WebRTCConnectionCallbacks = {}
  ) {
    this.signaling = signaling;
    this.roomId = roomId;
    this.role = role;
    this.callbacks = callbacks;

    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.sendIceCandidate(this.roomId, event.candidate.toJSON());
      }
    };

    this.pc.onconnectionstatechange = () => {
      console.log("[webrtc] connectionState:", this.pc.connectionState);
      this.callbacks.onConnectionStateChange?.(this.pc.connectionState);
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log("[webrtc] iceConnectionState:", this.pc.iceConnectionState);
    };

    if (this.role === "initiator") {
      // The initiator creates the data channel BEFORE creating the offer, so
      // it gets included in the SDP negotiation.
      this.dataChannel = this.pc.createDataChannel("file-transfer");
      this.attachDataChannelHandlers(this.dataChannel);
    } else {
      // The joiner receives the channel via this event instead of creating
      // its own.
      this.pc.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.attachDataChannelHandlers(this.dataChannel);
      };
    }

    this.signaling.onMessage((message) => {
      void this.handleSignalingMessage(message);
    });
  }

  private attachDataChannelHandlers(channel: RTCDataChannel) {
    // Ensures binary chunks (Phase 3 file transfer) arrive as ArrayBuffer
    // rather than Blob, which is consistent across browsers.
    channel.binaryType = "arraybuffer";
    channel.onopen = () => {
      console.log("[webrtc] data channel open");
      this.callbacks.onDataChannelOpen?.(channel);
      this.startStatsPolling();
    };
    channel.onmessage = (event) => {
      this.callbacks.onDataChannelMessage?.(event);
    };
    channel.onclose = () => {
      console.log("[webrtc] data channel closed");
      this.stopStatsPolling();
    };
  }

  // Phase 5a: poll RTCPeerConnection.getStats() every second to surface RTT,
  // connection type (host/srflx/relay), and live throughput to the UI overlay.
  private startStatsPolling() {
    this.lastStatsTime = performance.now();
    this.statsInterval = setInterval(() => {
      void this.collectStats();
    }, 1000);
  }

  private stopStatsPolling() {
    if (this.statsInterval !== null) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }

  private async collectStats() {
    const stats = await this.pc.getStats();
    let rttMs: number | null = null;
    let connectionType: string | null = null;
    let totalBytesReceived = 0;
    let totalBytesSent = 0;

    stats.forEach((report) => {
      if (report.type === "candidate-pair" && report.state === "succeeded") {
        // currentRoundTripTime is in seconds; convert to ms
        if (typeof report.currentRoundTripTime === "number") {
          rttMs = Math.round(report.currentRoundTripTime * 1000);
        }
        // totalBytesSent/Received on the candidate pair gives transfer throughput
        if (typeof report.bytesReceived === "number") totalBytesReceived += report.bytesReceived;
        if (typeof report.bytesSent === "number") totalBytesSent += report.bytesSent;
      }
      if (report.type === "local-candidate" && report.id) {
        // Match the local candidate of the selected pair to find the type
        stats.forEach((r) => {
          if (
            r.type === "candidate-pair" &&
            r.state === "succeeded" &&
            r.localCandidateId === report.id
          ) {
            connectionType = report.candidateType ?? null; // "host", "srflx", or "relay"
          }
        });
      }
    });

    const now = performance.now();
    const deltaMs = now - this.lastStatsTime;
    const deltaBytes =
      (totalBytesReceived - this.lastBytesReceived) +
      (totalBytesSent - this.lastBytesSent);
    const bytesPerSec = deltaMs > 0 ? Math.round((deltaBytes / deltaMs) * 1000) : 0;

    this.lastBytesReceived = totalBytesReceived;
    this.lastBytesSent = totalBytesSent;
    this.lastStatsTime = now;

    this.callbacks.onStatsUpdate?.({ rttMs, connectionType, bytesPerSec });
  }

  private async handleSignalingMessage(message: ServerMessage) {
    switch (message.type) {
      case "peer-joined": {
        // Only the initiator starts the offer -- once both sides have joined
        // the room, it's safe to begin the SDP exchange.
        if (this.role === "initiator") {
          await this.createAndSendOffer();
        }
        break;
      }

      case "offer": {
        await this.pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
        this.remoteDescriptionSet = true;
        await this.flushPendingCandidates();

        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        await this.signaling.sendAnswer(this.roomId, answer);
        break;
      }

      case "answer": {
        await this.pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
        this.remoteDescriptionSet = true;
        await this.flushPendingCandidates();
        break;
      }

      case "ice-candidate": {
        if (this.remoteDescriptionSet) {
          await this.pc.addIceCandidate(new RTCIceCandidate(message.candidate));
        } else {
          this.pendingCandidates.push(message.candidate);
        }
        break;
      }

      case "peer-left": {
        console.log("[webrtc] peer left the room");
        break;
      }

      case "room-full":
      case "error": {
        console.error("[webrtc] signaling error:", message);
        break;
      }
    }
  }

  private async flushPendingCandidates() {
    while (this.pendingCandidates.length > 0) {
      const candidate = this.pendingCandidates.shift()!;
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  private async createAndSendOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.signaling.sendOffer(this.roomId, offer);
  }

  getDataChannel() {
    return this.dataChannel;
  }

  close() {
    this.stopStatsPolling();
    this.dataChannel?.close();
    this.pc.close();
  }
}