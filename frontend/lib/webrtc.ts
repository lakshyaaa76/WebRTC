// Phase 2: drives the actual WebRTC handshake — SDP offer/answer, ICE candidate
// exchange, and RTCDataChannel setup — using the SignalingClient from Phase 1
// purely as a transport for the handshake messages.

import { SignalingClient, ServerMessage } from "./signaling";

// Kept for UI state typing in [id].tsx — no longer used internally to drive
// offer creation (that is now determined by the server-side shouldInitiate flag).
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
  private dataChannel: RTCDataChannel | null = null;
  private statsInterval: ReturnType<typeof setInterval> | null = null;
  private lastBytesReceived = 0;
  private lastBytesSent = 0;
  private lastStatsTime = 0;

  // ICE candidates can arrive before offer/answer round-trip completes.
  // Queued here and flushed once remote description is set.
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet = false;

  private callbacks: WebRTCConnectionCallbacks;

  // Stored so close() can remove it from the SignalingClient — prevents stale
  // handlers accumulating across reconnections.
  private boundSignalingHandler: (message: ServerMessage) => void;

  // ---------------------------------------------------------------------------
  // ICE server config
  // ---------------------------------------------------------------------------

  // Fetch STUN + TURN servers. Called fresh on every restart() so credentials
  // are always up-to-date.
  static async fetchIceServers(): Promise<RTCIceServer[]> {
    const iceServers: RTCIceServer[] = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
    ];
    try {
      const res = await fetch("/api/turn");
      if (res.ok) {
        const { username, credential } = await res.json();
        if (username && credential) {
          // All four openrelay.metered.ca endpoints — if one port is blocked by a
          // firewall or the credential is rate-limited on one URL, the browser
          // automatically tries the next candidate.
          iceServers.push(
            { urls: "turn:openrelay.metered.ca:80",                username, credential },
            { urls: "turn:openrelay.metered.ca:80?transport=tcp",  username, credential },
            { urls: "turn:openrelay.metered.ca:443",               username, credential },
            { urls: "turn:openrelay.metered.ca:443?transport=tcp", username, credential },
            { urls: "turn:openrelay.metered.ca:3478",              username, credential }
          );
        }
      }
    } catch (e) {
      console.error("[webrtc] Failed to fetch TURN credentials — proceeding with STUN only", e);
    }
    return iceServers;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  // Creates the connection object and registers the signaling message handler.
  // Does NOT set up an RTCPeerConnection yet — call restart(shouldInitiate) when
  // the server sends peer-joined to initialise the pc with the correct role.
  // This is now synchronous so the handler is registered before joinRoom() fires.
  static create(
    signaling: SignalingClient,
    roomId: string,
    callbacks: WebRTCConnectionCallbacks = {}
  ): WebRTCConnection {
    return new WebRTCConnection(signaling, roomId, callbacks);
  }

  private constructor(
    signaling: SignalingClient,
    roomId: string,
    callbacks: WebRTCConnectionCallbacks = {}
  ) {
    this.signaling = signaling;
    this.roomId = roomId;
    this.callbacks = callbacks;

    // Bare, unconfigured pc — minimal resources until restart() is called.
    this.pc = new RTCPeerConnection({});

    this.boundSignalingHandler = (message) => {
      void this.handleSignalingMessage(message);
    };
    this.signaling.onMessage(this.boundSignalingHandler);
  }

  // (Re-)initialise the RTCPeerConnection with a fresh ICE config and correct role.
  // Safe to call multiple times — tears down the previous pc cleanly each time.
  // shouldInitiate comes from the server (peer-joined message) so the server,
  // not the URL path, decides who creates the offer.
  async restart(shouldInitiate: boolean): Promise<void> {
    console.log("[webrtc] restart — shouldInitiate:", shouldInitiate);

    // Tear down existing pc and data channel.
    this.stopStatsPolling();
    this.dataChannel?.close();
    this.dataChannel = null;
    this.pc.close();

    // Reset negotiation state for the new session.
    this.remoteDescriptionSet = false;
    this.pendingCandidates = [];

    // Build a fresh pc with up-to-date ICE credentials.
    const iceServers = await WebRTCConnection.fetchIceServers();
    this.pc = new RTCPeerConnection({ iceServers });
    this.initPc(shouldInitiate);

    // Initiator creates the offer immediately; responder waits for it.
    if (shouldInitiate) {
      await this.createAndSendOffer();
    }
  }

  // Wire up all RTCPeerConnection event handlers and set up the data channel
  // (created by initiator, received via ondatachannel by responder).
  private initPc(shouldInitiate: boolean): void {
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

    if (shouldInitiate) {
      // Create the data channel BEFORE creating the offer so it's included in SDP.
      this.dataChannel = this.pc.createDataChannel("file-transfer");
      this.attachDataChannelHandlers(this.dataChannel);
    } else {
      this.pc.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.attachDataChannelHandlers(this.dataChannel);
      };
    }
  }

  close() {
    this.stopStatsPolling();
    this.dataChannel?.close();
    this.pc.close();
    // Remove our handler from the SignalingClient so stale callbacks don't fire
    // after this connection is replaced by a new one.
    this.signaling.offMessage(this.boundSignalingHandler);
  }

  // ---------------------------------------------------------------------------
  // Data channel
  // ---------------------------------------------------------------------------

  private attachDataChannelHandlers(channel: RTCDataChannel) {
    // Ensures binary chunks arrive as ArrayBuffer rather than Blob.
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

  getDataChannel() {
    return this.dataChannel;
  }

  // ---------------------------------------------------------------------------
  // Stats polling
  // ---------------------------------------------------------------------------

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
        if (typeof report.currentRoundTripTime === "number") {
          rttMs = Math.round(report.currentRoundTripTime * 1000);
        }
        if (typeof report.bytesReceived === "number") totalBytesReceived += report.bytesReceived;
        if (typeof report.bytesSent    === "number") totalBytesSent     += report.bytesSent;
      }
      if (report.type === "local-candidate" && report.id) {
        stats.forEach((r) => {
          if (
            r.type === "candidate-pair" &&
            r.state === "succeeded" &&
            r.localCandidateId === report.id
          ) {
            connectionType = report.candidateType ?? null;
          }
        });
      }
    });

    const now = performance.now();
    const deltaMs    = now - this.lastStatsTime;
    const deltaBytes =
      (totalBytesReceived - this.lastBytesReceived) +
      (totalBytesSent     - this.lastBytesSent);
    const bytesPerSec = deltaMs > 0 ? Math.round((deltaBytes / deltaMs) * 1000) : 0;

    this.lastBytesReceived = totalBytesReceived;
    this.lastBytesSent     = totalBytesSent;
    this.lastStatsTime     = now;

    this.callbacks.onStatsUpdate?.({ rttMs, connectionType, bytesPerSec });
  }

  // ---------------------------------------------------------------------------
  // Signaling message handler
  // ---------------------------------------------------------------------------

  private async handleSignalingMessage(message: ServerMessage) {
    switch (message.type) {
      case "peer-joined": {
        // The room page ([id].tsx) handles peer-joined by calling restart(message.shouldInitiate).
        // Nothing to do here — role assignment and pc creation happen in restart().
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
}