# WebRTC P2P File Transfer — Build Phases

Self-contained build plan. Paste this file (plus `project_context.md` if deeper detail
is needed) into a new chat at the start of each phase — it has enough context to pick
up the work without re-explaining the project.

**Rule for every phase:** build and verify locally before moving to the next. Nothing
here is deployed until the final, optional phase.

**Stack reminder (fixed, do not substitute):** Next.js + Tailwind (frontend), Node.js +
`ws` (signaling server), Google STUN, Open Relay via Metered.ca (TURN fallback, needs a
free account + API-fetched credentials), no database.

---

## Phase 0 — Project scaffolding — **Status: Completed**

**Goal:** Get the two halves of the repo initialized and running side by side, doing nothing yet.

**Files to create:**
```
/
├── frontend/          # npx create-next-app, TypeScript + Tailwind
│   └── pages/
│       ├── index.tsx
│       └── room/[id].tsx
└── signaling/
    ├── server.js
    └── package.json
```

**What "done" looks like:**
- `cd frontend && npm run dev` serves a blank Next.js page at `localhost:3000`.
- `cd signaling && node server.js` starts a plain WebSocket server (using `ws`) on
  `localhost:8000` that logs connections but doesn't do anything else yet.

**Checkpoint:** Open `localhost:3000` in a browser (loads without errors) and connect to
`ws://localhost:8000` from the browser devtools console — confirm you see a "client
connected" log on the server side.

---

## Phase 1 — Signaling server — **Status: Completed**

**Goal:** Rooms can be created and joined; the server brokers offer/answer/ICE messages
between exactly two sockets per room. No WebRTC objects yet — just the message-passing
layer.

**Files to create/edit:**
- `signaling/server.js` — full implementation
- `frontend/lib/signaling.ts` — thin client wrapper around the WebSocket

**Message protocol (define exactly this — needed since the original brief didn't
specify wire formats):**
```json
// Client → Server
{ "type": "create-room" }
{ "type": "join-room", "roomId": "AB12CD" }
{ "type": "offer", "roomId": "...", "sdp": {...} }
{ "type": "answer", "roomId": "...", "sdp": {...} }
{ "type": "ice-candidate", "roomId": "...", "candidate": {...} }
{ "type": "leave-room", "roomId": "..." }

// Server → Client
{ "type": "room-created", "roomId": "AB12CD" }
{ "type": "peer-joined" }
{ "type": "room-full" }
{ "type": "offer", "sdp": {...} }        // relayed
{ "type": "answer", "sdp": {...} }       // relayed
{ "type": "ice-candidate", "candidate": {...} }  // relayed
{ "type": "peer-left" }
```

**Server logic to implement:**
- In-memory map: `roomId → [socketA, socketB?]`. This is ephemeral, in-memory state
  (not "stateless" — it holds state for the lifetime of the room, just never persisted).
- 6-character random alphanumeric room code generation.
- On `join-room`: if room already has 2 sockets, reply `room-full` and do not add the
  socket. Otherwise add it and notify both sockets with `peer-joined`.
- Relay `offer` / `answer` / `ice-candidate` messages to the *other* socket in the room,
  unchanged.
- On socket disconnect: remove it from its room; if the room is now empty, delete the
  room entry; if the other peer is still connected, send it `peer-left`.

**What "done" looks like:**
- Two browser tabs can each open a WebSocket, one creates a room, the other joins it
  using the returned code, and both see confirmation messages logged in the console.
- A third tab attempting to join the same room gets `room-full`.
- Closing one tab causes the other to receive `peer-left`.

**How to test locally:**
Use the browser devtools console in two tabs pointed at `localhost:3000` (or a minimal
test HTML page) to manually send the JSON messages above over a raw WebSocket and watch
the server logs / responses. No UI needed yet.

**Checkpoint:** In two tabs, manually run through create-room → join-room → confirm
`peer-joined` fires on both sides → close one tab → confirm the other receives
`peer-left`.

---

## Phase 2 — WebRTC handshake (SDP + ICE + data channel) — **Status: Completed**

**Goal:** Two browser tabs establish a real `RTCPeerConnection` and open a
`RTCDataChannel` between them, using the signaling server from Phase 1 purely to
exchange SDP/ICE messages.

**Files to create/edit:**
- `frontend/lib/webrtc.ts` — `RTCPeerConnection` setup, offer/answer creation,
  ICE candidate handling (including the queue-until-remote-description-set logic),
  data channel creation/attachment
- `frontend/pages/room/[id].tsx` — wire up: on page load, join room via signaling,
  then drive the WebRTC handshake

**Implementation details to get right:**
- ICE server config:
  ```js
  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    // TURN added once you've signed up for a free Open Relay account and
    // fetched short-lived credentials via their API — see notes below
  ];
  ```
- The room creator is the "initiator": it calls `createDataChannel(...)` **before**
  calling `createOffer()`, so the channel is included in the SDP negotiation. The
  joiner receives the channel via the `ondatachannel` event — it does not create one
  itself.
- Queue any ICE candidates that arrive before `setRemoteDescription()` has resolved;
  flush the queue immediately after.
- Log `connectionState` / `iceConnectionState` changes to the console for now — the
  UI overlay for this comes in Phase 3.
- TURN is not required to complete this phase on localhost (same-machine tabs use
  `host` candidates), but stub in the Open Relay TURN entry now (even with placeholder
  credentials) so Phase 3's "connection type" stat has something real to report when
  testing across networks later. Signing up for a free Open Relay account and fetching
  `iceServers` credentials via their API is a small, one-time setup step — do it now
  rather than leaving TURN entirely absent.

**What "done" looks like:**
- Two tabs on `localhost` complete the full offer/answer/ICE exchange automatically
  after both join the same room.
- The data channel's `onopen` event fires on both sides.
- Typing a test string into one tab's data channel and seeing it logged in the other
  tab's console confirms the channel actually works, before any file logic exists.

**How to test locally:**
Open two tabs at the same room URL. Watch the console for `iceConnectionState:
connected` and a data channel `onopen` log on both sides. Send a plain string over the
channel from one tab (via devtools) and confirm it's received in the other.

**Checkpoint:** Both tabs log "data channel open" and a manually sent test string
appears in the other tab's console.

**Implementation note:** since the real create/join UI doesn't exist until Phase 4,
`/room/[id].tsx` currently treats the special URL `/room/new` as the initiator path
(calls `create-room`, displays the generated code) and any other `:id` as the joiner
path (calls `join-room` with that code directly). Phase 4 kept this convention rather
than replacing it: the "Create Room" button navigates straight to `/room/new`, and the
room page itself rewrites the URL to `/room/<code>` once the server responds (via
`router.replace`, guarded so the handshake isn't re-run) -- this avoids a race between
a separate room-creation step on the index page and the eventual WebRTC connection.

---

## Phase 3 — File chunking and transfer — **Status: Completed**

**Goal:** An actual file selected in one tab is chunked, sent over the data channel,
reassembled in the other tab, and triggers a real download.

**Files to create/edit:**
- `frontend/lib/chunker.ts` — chunking (sender side) and reassembly (receiver side)
- `frontend/lib/webrtc.ts` — extend to handle binary + JSON framing on the same channel
- `frontend/components/FileDropzone.tsx` — basic file picker (drag-and-drop comes in
  Phase 5)

**Protocol to implement (from `project_context.md`):**
- Sender sends one JSON header frame first:
  `{ "type": "file-start", "fileName", "fileSize", "totalChunks", "mimeType" }`
- Then sends the file in 16KB binary chunks, in order.
- Before each `send()`, check `dataChannel.bufferedAmount`; if above a threshold
  (e.g. 1MB), pause and wait for a `bufferedamountlow` event
  (`bufferedAmountLowThreshold` set accordingly) before continuing.
- Sender sends a final JSON frame: `{ "type": "file-end", "fileName" }`.
- Receiver pushes incoming binary chunks into an array; on `file-end`, concatenates
  them into a `Blob` with the declared MIME type and triggers a download via a
  temporary `<a>` + `URL.createObjectURL`.

**What "done" looks like:**
- Selecting a file (start with something small, a few hundred KB) in one tab results
  in a download prompt appearing in the other tab with the correct file name and
  content.
- Test with a large file (100MB+) to confirm backpressure handling prevents the tab
  from freezing or ballooning in memory.

**How to test locally:**
Two tabs, same room, complete Phase 2's handshake, then pick a file in one tab and
confirm the exact same file (verify by checksum or just by opening it) downloads in
the other. Test both a small file and a large one.

**Checkpoint:** A real file, selected in tab A, downloads correctly and completely in
tab B — verified with both a small and a large test file.

---

## Phase 4 — UI (progress, room creation/join flow) — **Status: Completed**

**Goal:** Turn the console-driven prototype into an actual usable interface.

**Files to create/edit:**
- `frontend/pages/index.tsx` — "create room" button, generates link
- `frontend/pages/room/[id].tsx` — join flow, file picker, progress bar
- `frontend/components/TransferProgress.tsx` — live progress bar: % complete, speed
  (bytes/sec, sampled over a short rolling window), ETA

**What "done" looks like:**
- Visiting `/` and clicking "create room" generates a shareable room link.
- Opening that link in a second tab joins the room automatically.
- Selecting a file shows a live progress bar with percentage, speed, and ETA that
  update smoothly during transfer on both sender and receiver sides.
- Receiver sees a clear "download ready" state when complete.

**How to test locally:**
Full manual click-through in two tabs: create room → copy link → open in second tab →
pick a file → watch progress update on both sides → confirm download.

**Checkpoint:** A person unfamiliar with the code could create a room, share the link,
and transfer a file using only the UI — no devtools needed.

---

## Phase 5 — Polish (stats overlay, multi-file, drag-and-drop, mobile layout) — **Status: Completed**

**Goal:** Round out the remaining features from the brief's build order.

**Sub-phases (each independently testable):**

**5a. Transfer stats overlay**
- Add RTT, connection type (`host`/`srflx`/`relay`, read from
  `RTCPeerConnection.getStats()`), and current bytes/sec to a small overlay panel.
- Test: on localhost, confirm connection type reads as `host`. Note in the UI or a
  code comment that this is expected on same-machine tabs — this is *not* a bug.

**5b. Multi-file support**
- Extend the chunker/transfer logic to queue multiple selected files and send them
  sequentially over the same open data channel (no renegotiation needed between
  files).
- Test: select 3+ files at once, confirm all arrive and download correctly, in order.

**5c. Drag-and-drop + mobile-friendly layout**
- Extend `FileDropzone.tsx` to accept drag-and-drop in addition to click-to-pick.
- Responsive layout pass with Tailwind for mobile viewport widths.
- Test: drag a file onto the dropzone; resize the browser to a mobile width and
  confirm the layout holds up.

**What "done" looks like (whole phase):**
- Stats overlay updates live during a transfer.
- Multiple files transfer correctly in one session.
- Drag-and-drop works alongside the existing file picker.
- Layout is usable on a narrow (mobile-width) viewport.

**Checkpoint:** Full end-to-end run on localhost — two tabs, drag-and-drop multiple
files, watch the stats overlay and progress bars update, confirm all files download
correctly.

---

## Phase 6 — Deployment (OPTIONAL — only after Phase 5 works fully on localhost)

Do not start this phase until every phase above is complete and verified locally.
This phase is about proving the app works across real devices/networks, not about
building any new features.

### Step 1 — Quick cross-device testing with ngrok

Two tunnels are needed, not one — the original plan only tunneled the signaling
server, but a second physical device also needs to load the Next.js frontend itself,
not just reach the signaling server:

```bash
ngrok http 8000   # tunnels the signaling server
ngrok http 3000   # tunnels the frontend
```

- Point the frontend's WebSocket connection at the ngrok URL for port 8000 (use
  `wss://` since ngrok serves over HTTPS).
- Open the ngrok URL for port 3000 on the second device instead of `localhost:3000`.
- Both devices, on any network, should now be able to complete a real P2P transfer.
- Ngrok's free tier is sufficient because only small JSON signaling messages pass
  through the port 8000 tunnel — file data never does, and file data over the
  port 3000 tunnel is just the initial page load, not the transfer itself.

**Checkpoint:** Two separate physical devices, each on a different network (e.g. one on
Wi-Fi, one on mobile data), complete a real file transfer using the two ngrok URLs.

### Step 2 — Full deployment (Render + Vercel)

- Deploy `signaling/server.js` to **Render free tier**. Note the deployed `wss://`
  URL Render provides.
- Deploy `frontend/` to **Vercel**, setting an environment variable for the signaling
  WebSocket URL to Render's `wss://` address.
- **Important:** the frontend will be served over HTTPS by Vercel, so the WebSocket
  connection to the signaling server must use `wss://`, not `ws://` — browsers block
  insecure WebSocket connections from an HTTPS page as mixed content. Render's HTTPS
  domain supports `wss://` automatically, so this just needs to be reflected in the
  frontend's environment variable, not a server-side change.
- Confirm the TURN (Open Relay) credentials used in Phase 2 are the real, account-based
  ones rather than placeholders, since production traffic will genuinely need TURN
  fallback across arbitrary real-world NAT configurations.

**Checkpoint:** Two devices anywhere in the world, no ngrok, using only the deployed
Vercel URL, complete a real file transfer.

### After deployment

- Write the README with the architecture explanation (can lean on
  `project_context.md`'s architecture diagram and lifecycle section) and record a demo
  GIF of a real two-device transfer.