import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { SignalingClient } from "../../lib/signaling";
import { WebRTCConnection, PeerRole } from "../../lib/webrtc";
import { FileSender, FileReceiver, downloadBlob } from "../../lib/chunker";
import FileDropzone from "../../components/FileDropzone";
import TerminalWindow from "../../components/TerminalWindow";
import TransferProgress from "../../components/TransferProgress";

interface ActiveTransfer {
  fileName: string;
  percent: number;
  bytesTransferred: number;
  totalBytes: number;
  speed: number;
}

// Phase 4: real UI on top of the Phase 2/3 plumbing. /room/new still drives
// the initiator path internally (creates the room), but the URL is updated
// to the real room code as soon as the server responds, so the address bar
// always shows a shareable link once one exists.
export default function Room() {
  const router = useRouter();
  const { id } = router.query;

  const [roomId, setRoomId] = useState<string | null>(null);
  const [role, setRole] = useState<PeerRole | null>(null);
  const [channelOpen, setChannelOpen] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [transfer, setTransfer] = useState<ActiveTransfer | null>(null);
  const [receivedFiles, setReceivedFiles] = useState<string[]>([]);

  const connectionRef = useRef<WebRTCConnection | null>(null);
  const senderRef = useRef<FileSender | null>(null);
  const initializedRef = useRef(false);
  const speedSampleRef = useRef<{ time: number; bytes: number } | null>(null);

  const addLog = (line: string) => setLogLines((prev) => [...prev, line]);

  const computeSpeed = (bytesTransferred: number): number => {
    const now = performance.now();
    if (!speedSampleRef.current) {
      speedSampleRef.current = { time: now, bytes: bytesTransferred };
      return 0;
    }
    const deltaTime = (now - speedSampleRef.current.time) / 1000;
    const deltaBytes = bytesTransferred - speedSampleRef.current.bytes;
    speedSampleRef.current = { time: now, bytes: bytesTransferred };
    return deltaTime > 0 ? deltaBytes / deltaTime : 0;
  };

  useEffect(() => {
    if (!router.isReady || typeof router.query.id !== "string") return;
    // Guards against re-running this setup when the URL is rewritten below
    // (router.query change would otherwise re-trigger this effect and open
    // a second, redundant connection).
    if (initializedRef.current) return;
    initializedRef.current = true;

    const initialId = router.query.id;

    const signaling = new SignalingClient();
    addLog("$ connecting to signaling server...");

    const setupChannel = (channel: RTCDataChannel) => {
      addLog("$ data channel: open — ready to send files");
      setChannelOpen(true);

      senderRef.current = new FileSender(channel, {
        onProgress: ({ fileName, bytesTransferred, totalBytes }) => {
          setTransfer({
            fileName,
            percent: Math.round((bytesTransferred / totalBytes) * 100),
            bytesTransferred,
            totalBytes,
            speed: computeSpeed(bytesTransferred),
          });
        },
        onFileComplete: (fileName) => {
          addLog(`$ sent ${fileName}`);
          speedSampleRef.current = null;
          setTransfer(null);
        },
      });

      new FileReceiver(channel, {
        onProgress: ({ fileName, bytesTransferred, totalBytes }) => {
          setTransfer({
            fileName,
            percent: Math.round((bytesTransferred / totalBytes) * 100),
            bytesTransferred,
            totalBytes,
            speed: computeSpeed(bytesTransferred),
          });
        },
        onFileReceived: (blob, fileName) => {
          downloadBlob(blob, fileName);
          addLog(`$ received ${fileName}`);
          setReceivedFiles((prev) => [...prev, fileName]);
          speedSampleRef.current = null;
          setTransfer(null);
        },
      });
    };

    signaling.onMessage((message) => {
      switch (message.type) {
        case "room-created":
          setRoomId(message.roomId);
          setRole("initiator");
          addLog(`$ room ${message.roomId} ready — waiting for peer`);
          router.replace(`/room/${message.roomId}`, undefined, { shallow: true });

          connectionRef.current = new WebRTCConnection(
            signaling,
            message.roomId,
            "initiator",
            {
              onDataChannelOpen: setupChannel,
              onConnectionStateChange: (state) => addLog(`$ connection: ${state}`),
            }
          );
          break;
        case "peer-joined":
          addLog("$ peer joined — negotiating connection...");
          break;
        case "peer-left":
          addLog("$ peer left the room");
          setChannelOpen(false);
          break;
        case "room-full":
          addLog("$ error: room is full");
          break;
        case "error":
          addLog(`$ error: ${message.message}`);
          break;
      }
    });

    if (initialId === "new") {
      signaling.createRoom();
    } else {
      setRoomId(initialId);
      setRole("joiner");
      addLog(`$ joining room ${initialId}...`);
      signaling.joinRoom(initialId);
      connectionRef.current = new WebRTCConnection(signaling, initialId, "joiner", {
        onDataChannelOpen: setupChannel,
        onConnectionStateChange: (state) => addLog(`$ connection: ${state}`),
      });
    }

    return () => {
      initializedRef.current = false;
      connectionRef.current?.close();
      signaling.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  const handleFilesSelected = (files: FileList) => {
    senderRef.current?.enqueue(files);
  };

  return (
    <main className="flex h-screen w-screen">
      <TerminalWindow title={roomId ? `room ${roomId} — zsh` : "connecting — zsh"}>
        <div className="mb-4 space-y-1 text-sm">
          {logLines.map((line, i) => (
            <p key={i} className="text-term-dim">
              {line}
            </p>
          ))}
        </div>

        {role === "initiator" && roomId && (
          <p className="mb-6 text-term-cyan">
            share this link: <span className="text-term-fg">/room/{roomId}</span>
          </p>
        )}

        <div className="mb-6">
          <FileDropzone onFilesSelected={handleFilesSelected} disabled={!channelOpen} />
        </div>

        {transfer && (
          <div className="mb-6">
            <TransferProgress
              fileName={transfer.fileName}
              percent={transfer.percent}
              bytesTransferred={transfer.bytesTransferred}
              totalBytes={transfer.totalBytes}
              speedBytesPerSec={transfer.speed}
            />
          </div>
        )}

        {receivedFiles.length > 0 && (
          <div className="text-sm">
            <p className="mb-1 text-term-magenta">$ ls ./received</p>
            <ul>
              {receivedFiles.map((name) => (
                <li key={name} className="text-term-dim">
                  {name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </TerminalWindow>
    </main>
  );
}