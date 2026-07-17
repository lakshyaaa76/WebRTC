# WebRTC P2P File Transfer — Project Context

This is the full technical reference for the project. Paste this file into a new chat
at the start of any phase if you need Claude to have complete context without re-explaining
the project from scratch.

## 1. What this project is

A browser-based file transfer app where two users share files of any size directly,
browser-to-browser, over an encrypted WebRTC data channel. No file content ever touches
a server — only tiny signaling messages (SDP offers/answers, ICE candidates) pass through
the backend to help the two browsers find and connect to each other.

**Stack (fixed, do not substitute):**
- Frontend: Next.js + Tailwind
- Signaling server: Node.js + `ws` (plain WebSocket library, no framework)
- STUN: Google public STUN (`stun.l.google.com:19302`)
- TURN: Open Relay, provided by Metered.ca (free tier, fallback only)
- Hosting (optional, later): Vercel (frontend) + Render free tier (signaling server)
- Database: none — rooms are ephemeral, nothing is persisted

---

## 2. Architecture diagram

```
                         ┌─────────────────────────────┐
                         │      Signaling Server        │
                         │   (Node.js + ws, Render)     │
                         │                               │
                         │  In-memory room table:        │
                         │  { roomId: [socketA, socketB] }│
                         │  (ephemeral — held only in    │
                         │  process memory, wiped when   │
                         │  both peers disconnect;       │
                         │  never persisted to disk/DB)  │
                         └───────────┬──────────┬────────┘
                                     │          │
                     WebSocket (JSON:│          │WebSocket (JSON:
                     join/offer/     │          │join/answer/
                     answer/ice)     │          │ice/leave)
                                     │          │
                     ┌───────────────▼──┐    ┌──▼───────────────┐
                     │   Browser A       │    │   Browser B       │
                     │   (Sender)        │    │   (Receiver)      │
                     │                   │    │                   │
                     │  RTCPeerConnection│    │  RTCPeerConnection│
                     └─────────┬─────────┘    └─────────┬─────────┘
                               │                          │
                               │   ICE negotiation via:    │
                               │   ┌──────────────────┐    │
                               ├──▶│  STUN (Google)   │◀───┤
                               │   │  discovers public │   │
                               │   │  IP:port of each  │   │
                               │   │  peer             │   │
                               │   └──────────────────┘    │
                               │                          │
                               │   Direct P2P attempted    │
                               │   first. If it fails      │
                               │   (symmetric NAT):        │
                               │   ┌──────────────────┐    │
                               ├──▶│  TURN (Open Relay │◀───┤
                               │   │  via Metered.ca)  │    │
                               │   │  relays encrypted │    │
                               │   │  bytes as last     │   │
                               │   │  resort — cannot   │   │
                               │   │  decrypt them      │   │
                               │   └──────────────────┘    │
                               │                          │
                     ┌─────────▼─────────────────────────▼─────────┐
                     │      RTCDataChannel (DTLS-encrypted,          │
                     │      reliable + ordered, default mode)        │
                     │                                                │
                     │      Sender: reads File → 16KB chunks         │
                     │      → sends over channel with backpressure   │
                     │      Receiver: reassembles chunks in-memory   │
                     │      → Blob → triggers download                │
                     └────────────────────────────────────────────────┘
```

Key point the diagram is meant to make obvious: **the signaling server sits entirely
outside the file-transfer path.** Once the data channel opens, the server could vanish
and the transfer would continue uninterrupted.

---

## 3. Connection lifecycle, step by step

### Step 1 — Room creation
- Sender opens the app, hits "create room."
- Frontend opens a WebSocket to the signaling server and sends `{"type": "create-room"}`.
- Server generates a 6-character alphanumeric room code, creates an in-memory entry
  `{ roomId: [senderSocket] }`, and returns `{"type": "room-created", "roomId": "..."}`.
- Sender shares the room link (`/room/<roomId>`) with the receiver.

### Step 2 — Peer joins
- Receiver opens the link, frontend opens its own WebSocket and sends
  `{"type": "join-room", "roomId": "..."}`.
- Server checks the room: if it already has 2 sockets, respond with
  `{"type": "room-full"}` and reject. Otherwise add the socket to the room array and
  notify both sides with `{"type": "peer-joined"}` so each side knows it's safe to start
  the SDP exchange.

### Step 3 — Signaling (SDP offer/answer)
- The peer who initiates (by convention, the room creator) creates an `RTCPeerConnection`,
  calls `createOffer()`, sets it as its local description, and sends
  `{"type": "offer", "sdp": ...}` through the signaling server to the other peer.
- The other peer sets that as its remote description, calls `createAnswer()`, sets it
  locally, and sends `{"type": "answer", "sdp": ...}` back.
- This is purely a negotiation of codecs/format/connection parameters — no network
  path has been chosen yet.

### Step 4 — ICE candidate gathering and exchange
- As soon as each `RTCPeerConnection` is created, the browser starts gathering ICE
  candidates asynchronously (this can happen before or after the offer/answer exchange
  completes — candidates trickle in over time).
- Each candidate found (host / STUN-reflexive / TURN-relayed) is sent to the other peer
  as `{"type": "ice-candidate", "candidate": ...}` via the signaling server.
- **Race condition to guard against:** a peer may receive ICE candidates before it has
  set a remote description (e.g. before the offer/answer round-trip finishes). Candidates
  arriving early must be queued and applied only after `setRemoteDescription()` succeeds.
- The browser tries candidate pairs in priority order: host-to-host (same network) first,
  then STUN-reflexive (direct P2P across networks), and only falls back to TURN-relayed
  if nothing else works (typically due to symmetric NAT).

### Step 5 — Data channel opens
- The initiating peer creates the data channel (`peerConnection.createDataChannel(...)`,
  default config = reliable + ordered, like TCP) before creating its offer, so it's
  included in the SDP negotiation.
- The other peer receives it via the `ondatachannel` event.
- Once ICE completes and DTLS handshake finishes, the channel's `onopen` event fires on
  both sides — this is the actual "connected" moment. From here, the signaling server is
  no longer needed for anything file-related (it may still be used for "peer left" events).

### Step 6 — File transfer
- Sender reads the selected file in 16KB chunks (see chunking protocol below), sending
  each one over the data channel while watching `bufferedAmount` for backpressure.
- Receiver accumulates chunks into an in-memory buffer, tracking progress against the
  total chunk count declared in the metadata header.
- Both sides update UI: percentage complete, live transfer speed (bytes/sec, sampled
  over a short rolling window), and ETA (remaining bytes ÷ current speed).

### Step 7 — Completion and teardown
- Once the last chunk arrives, the receiver reassembles the full `ArrayBuffer`, wraps it
  in a `Blob` with the correct MIME type, and triggers a download via a temporary
  `<a>` element / `URL.createObjectURL`.
- If there are more files queued, the process repeats sequentially over the same data
  channel (no need to renegotiate).
- When either tab closes or the user leaves, the WebSocket disconnects, the signaling
  server removes that socket from the room, and if both sockets are gone the room entry
  is deleted from memory.

---

## 4. Chunking and reassembly protocol

**Chunk size:** 16KB.

Correction from the original brief: this is *not* a hard browser-imposed ceiling —
actual max `RTCDataChannel` message sizes vary by browser and can be considerably
larger. 16KB is used because it's a **conservative, widely-adopted convention** that:
- Behaves predictably across Chrome and Firefox without hitting browser-specific edge
  cases at larger sizes,
- Keeps each `send()` call small enough that `bufferedAmount` backpressure (see below)
  stays responsive and doesn't let megabytes queue up in the browser's internal buffer,
  which is the real risk for large files.

**Header/metadata framing:**
Before sending the binary stream for a file, the sender sends one JSON text frame over
the same data channel describing the file:
```json
{
  "type": "file-start",
  "fileName": "photo.png",
  "fileSize": 4831201,
  "totalChunks": 295,
  "mimeType": "image/png"
}
```
Then chunks are sent as raw binary `ArrayBuffer` messages, in order, each implicitly
indexed by arrival order (since the channel is reliable + ordered, explicit chunk-index
fields aren't strictly required for correctness — but including a chunk index in a
lightweight way, e.g. as the first few bytes of each chunk or a periodic checkpoint
frame, makes debugging and progress tracking far easier and is worth the small overhead).
A final frame:
```json
{ "type": "file-end", "fileName": "photo.png" }
```
signals the receiver to finalize reassembly for that file and move to the next queued
file, if any.

**Backpressure handling:**
- Before each `send()`, check `dataChannel.bufferedAmount`.
- If it exceeds a threshold (e.g. 1MB), pause sending and wait for the
  `bufferedamountlow` event (with `bufferedAmountLowThreshold` set accordingly) before
  continuing. This prevents unbounded memory growth in the browser's send buffer when
  the receiver or network can't keep up with the sender.

**Reassembly:**
- Receiver pushes incoming `ArrayBuffer` chunks into an array as they arrive.
- On `file-end`, concatenate all chunks into a single `Blob` with the declared
  `mimeType`, then trigger the download.
- No streaming-to-disk mid-transfer — the whole file lives in memory on the receiver
  side until download. Acceptable for portfolio/demo scope; a known limitation for
  very large files (multi-GB) on memory-constrained devices.

---

## 5. System design decisions and reasoning

| Decision | Reasoning |
|---|---|
| Signaling holds only in-memory, per-process state (`roomId → sockets`), nothing persisted | Rooms are short-lived and disposable by design. Persisting them would add infrastructure cost and complexity for zero benefit — if the signaling server restarts, in-flight rooms simply need to be recreated. This is intentionally *not* "stateless" in the strict sense (it does hold state while a room is active) — it's ephemeral, in-memory state with no durability guarantee, which is the right tradeoff here. |
| 6-character random alphanumeric room codes, generated server-side | Long enough to avoid trivial collision/guessing for a low-traffic demo app, short enough to read aloud or type manually. Generating server-side avoids any client trusting its own uniqueness. |
| No authentication, no server-side file metadata | The privacy pitch of the whole app is "the server never sees your file." Storing metadata about files would undermine that promise and add attack surface for no functional gain. |
| STUN attempted first, TURN only as automatic fallback | Direct P2P (host or STUN-reflexive) is faster, cheaper, and more private (no third party touches bytes even in relay form) — TURN is deliberately treated as a last resort, only engaged when ICE detects that direct connectivity isn't possible (typically symmetric NAT). |
| Open Relay (via Metered.ca) chosen for TURN, requiring a free account + API-fetched credentials | Unlike Google's STUN server, TURN servers must authenticate to prevent abuse (open relays get hijacked for unrelated traffic otherwise). Open Relay's free tier provides 20GB of TURN relay bandwidth per month with unlimited STUN — sufficient for demo/portfolio purposes, but it does require signing up for a free API key and fetching short-lived `iceServers` credentials at runtime rather than hardcoding a public server URL the way Google STUN allows. |
| RTCDataChannel used in default reliable + ordered mode | File transfer requires every byte to arrive, in order — this is the same guarantee TCP gives, and it's `RTCDataChannel`'s default config, so no extra configuration is needed (unlike video/audio tracks, which often prefer unordered/unreliable modes for lower latency). |
| 16KB chunk size | See chunking protocol above — a conservative, cross-browser-safe convention that keeps `bufferedAmount` backpressure responsive, not a fixed technical ceiling. |
| Reassemble fully in-memory, then Blob-download (no streaming to disk) | Simpler implementation, sufficient for portfolio-scope files. Streaming to disk mid-transfer would require the File System Access API or similar, which is out of scope here. |
| Room capacity capped at 2 peers, third joiner rejected | The app is explicitly designed as a 1:1 transfer tool, not a multi-party mesh — enforcing this server-side keeps the signaling and data-channel logic simple (one `RTCPeerConnection` per browser, not N). |
| ICE candidates queued client-side until remote description is set | Candidates can arrive before the offer/answer round-trip completes (they're gathered asynchronously). Applying a candidate before `setRemoteDescription()` throws — queuing avoids a real race condition that would otherwise intermittently break connections. |

---

## 6. Known edge cases and how they're handled

- **TURN fallback (symmetric NAT):** ICE automatically tries host → STUN-reflexive →
  TURN-relayed candidate pairs in priority order. No app-level code needs to detect
  "STUN failed" — the browser's ICE agent handles this natively. The UI's "connection
  type" stat simply reports which candidate pair `RTCPeerConnection.getStats()` reports
  as selected, once available.
- **Large files:** handled via 16KB chunking + `bufferedAmount` backpressure so memory
  doesn't spike from the *sending* side buffering too aggressively. The known remaining
  limitation is the *receiving* side, which holds the whole reassembled file in memory
  before offering the download — very large files (multi-GB) on memory-constrained
  devices could hit browser tab memory limits. Out of scope to fix for portfolio scope,
  worth stating explicitly in the README as a known limitation.
- **Browser tab closed mid-transfer:** the `RTCPeerConnection`'s `oniceconnectionstatechange`
  / `onconnectionstatechange` events fire on the remaining peer (state moves to
  `disconnected`/`failed`), and the WebSocket disconnect is detected server-side, removing
  that socket from the room. The UI should surface a "peer disconnected, transfer failed"
  state rather than hanging silently.
- **Third peer tries to join a full room:** signaling server rejects with
  `{"type": "room-full"}`; frontend shows an appropriate message instead of attempting
  a connection.
- **ICE candidates arriving before remote description is set:** queued client-side and
  flushed once `setRemoteDescription()` resolves (see design decisions table above).
- **Two-device demo networking (ngrok) — frontend also needs to be reachable:** exposing
  only the signaling server via ngrok is not sufficient for a genuine second physical
  device to use the app, since that device also needs to load the Next.js frontend
  itself. For quick cross-device testing, either tunnel both `localhost:3000` and
  `localhost:8000` with two separate ngrok processes, or have the second device on the
  same LAN reach the frontend via the host machine's local network IP. This is called
  out explicitly in the deployment phase.
- **Mixed content in production (ws:// vs wss://):** once the frontend is served over
  HTTPS (Vercel), browsers will block insecure `ws://` WebSocket connections to the
  signaling server as mixed content. The signaling URL used by the deployed frontend
  must be `wss://`, which Render provides automatically over its HTTPS domain.

---

## 7. Interview Q&A

**1. Walk me through what happens when I open a room link and it connects to my friend's browser.**
Both browsers open a WebSocket to a lightweight signaling server that only exists to
exchange three things: an SDP offer, an SDP answer, and a trickle of ICE candidates.
Once both sides have exchanged those, each browser's ICE agent tries to find the best
network path — direct if possible, relayed via TURN if not — and once a path is found,
a `RTCDataChannel` opens directly between the two browsers. From that point on, the
signaling server isn't involved at all; file bytes never pass through it.

**2. What's the difference between STUN and TURN, and why do you need both?**
STUN tells a peer its own public IP and port as seen from outside its NAT — it doesn't
relay any data, it just helps two peers attempt a direct connection. TURN is a relay of
last resort: when NAT types on both sides are incompatible with a direct path (commonly
symmetric NAT), TURN forwards the encrypted traffic between peers. STUN is attempted
first because it's faster and keeps data fully peer-to-peer; TURN only engages
automatically when ICE determines direct connectivity has failed.

**3. Why did you chunk the file into 16KB pieces, and what problem does that solve?**
It's a conservative, cross-browser-safe chunk size that avoids browser-specific quirks
at larger message sizes and, more importantly, keeps each send small enough that
`bufferedAmount` backpressure stays responsive — without chunking and backpressure
checks, a large file could queue megabytes into the channel's internal send buffer
faster than the network or receiver can drain it, risking memory blowup or dropped
performance.

**4. What is `bufferedAmount` and why do you check it before sending?**
It's the number of bytes currently queued in the data channel waiting to be sent.
Because file reads can produce chunks much faster than the network can transmit them,
checking `bufferedAmount` before each `send()` — and pausing until a `bufferedamountlow`
event fires — prevents the sender from queuing unbounded data in memory, which would
otherwise degrade performance or crash the tab on very large files.

**5. Why doesn't any file data touch your server, and what does that actually buy you?**
The signaling server's only job is brokering the SDP/ICE handshake — a tiny amount of
JSON. Once the `RTCDataChannel` opens, file bytes flow directly between the two
browsers (or through TURN as an encrypted relay, in the worst case), never through
application code on the server. This means there's no server-side storage cost, no
server ever has plaintext access to file contents (data channels are DTLS-encrypted
end-to-end, and TURN relays can't decrypt what they forward), and no scaling concern
tied to file size or count — the signaling server's load is proportional to
connections, not to file traffic.

**6. What happens if a peer is behind a symmetric NAT and STUN fails?**
ICE candidate gathering will still produce host and STUN-reflexive candidates, but the
connectivity checks between those candidate pairs will fail to establish a direct path.
At that point ICE falls back to the TURN-relayed candidates that were also gathered
(assuming a TURN server was configured), and the connection completes through the
relay instead. This is fully automatic — the app doesn't need custom logic to detect
"symmetric NAT," it just needs a TURN server configured as one of the ICE servers.

**7. How would you compare this architecture to a traditional centralized file-sharing
service like WeTransfer?**
A centralized service uploads the full file to a server, stores it (temporarily),
and the recipient downloads it from there — this means storage cost scales with usage,
there's a window where a third party has the file at rest, and both legs of the
transfer (upload + download) are bottlenecked by the server's bandwidth. The P2P
architecture here trades that server-side simplicity for a more complex handshake
(NAT traversal, ICE, TURN fallback) in exchange for no storage cost, no third party
ever holding the file, and transfer speed limited only by the two peers' own network
conditions — at the cost of TURN-relay bandwidth caps and no persistence (once both
tabs close, the "share link" is gone).

**8. What's a limitation of this design you'd want to address if you were taking it
past a portfolio project?**
The receiver reassembles the entire file in memory before offering a download, which
doesn't scale to very large files on memory-constrained devices — a production version
would stream chunks directly to disk as they arrive (e.g. via the File System Access
API) rather than buffering the whole file in a `Blob`. Similarly, the free-tier TURN
bandwidth cap (20GB/month) would need a paid plan or self-hosted `coturn` instance
under real traffic.