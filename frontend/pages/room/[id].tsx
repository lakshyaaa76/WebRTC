import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { SignalingClient } from "../../lib/signaling";
import { WebRTCConnection, PeerRole, ConnectionStats } from "../../lib/webrtc";
import { FileSender, FileReceiver, downloadBlob } from "../../lib/chunker";
import FileDropzone from "../../components/FileDropzone";
import TerminalWindow from "../../components/TerminalWindow";
import TransferProgress from "../../components/TransferProgress";
import StatsOverlay from "../../components/StatsOverlay";

interface ActiveTransfer {
  fileName: string;
  percent: number;
  bytesTransferred: number;
  totalBytes: number;
  speed: number;
}

type LogType = 'system' | 'waiting' | 'error' | 'action';
type LogCategory = 'system' | 'connection' | 'transfer';

interface LogEntry {
  id: string;
  category: LogCategory;
  type: LogType;
  message: string;
}

const TYPE_COLORS: Record<LogType, string> = {
  system: "text-term-system",
  waiting: "text-term-waiting",
  error: "text-term-error",
  action: "text-term-action",
};

export default function Room() {
  const router = useRouter();

  const [roomId, setRoomId] = useState<string | null>(null);
  const [role, setRole] = useState<PeerRole | null>(null);
  const [channelOpen, setChannelOpen] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [expandedSections, setExpandedSections] = useState({ system: true, connection: true, transfer: true });
  const [transfer, setTransfer] = useState<ActiveTransfer | null>(null);
  const [receivedFiles, setReceivedFiles] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState<ConnectionStats | null>(null);

  const connectionRef = useRef<WebRTCConnection | null>(null);
  const senderRef = useRef<FileSender | null>(null);
  const initializedRef = useRef(false);
  const speedSampleRef = useRef<{ time: number; bytes: number } | null>(null);

  const addLog = (category: LogCategory, type: LogType, message: string) => {
    setLogs((prev) => [...prev, { id: Math.random().toString(36).slice(2), category, type, message }]);
  };

  const toggleSection = (category: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [category]: !prev[category] }));
  };

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
    if (initializedRef.current) return;
    initializedRef.current = true;

    const initialId = router.query.id;

    const signaling = new SignalingClient();
    addLog('system', 'waiting', "$ connecting to signaling server...");

    const setupChannel = (channel: RTCDataChannel) => {
      addLog('connection', 'system', "$ data channel: open — ready to send files");
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
          addLog('transfer', 'action', `$ sent ${fileName}`);
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
          addLog('transfer', 'action', `$ received ${fileName}`);
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
          addLog('system', 'waiting', `$ room ${message.roomId} ready — waiting for peer`);
          router.replace(`/room/${message.roomId}`, undefined, { shallow: true });

          connectionRef.current = new WebRTCConnection(
            signaling,
            message.roomId,
            "initiator",
            {
              onDataChannelOpen: setupChannel,
              onConnectionStateChange: (state) => addLog('connection', 'system', `$ connection: ${state}`),
              onStatsUpdate: (s) => setStats(s),
            }
          );
          break;
        case "peer-joined":
          addLog('connection', 'system', "$ peer joined — negotiating connection...");
          break;
        case "peer-left":
          addLog('connection', 'system', "$ peer left the room");
          setChannelOpen(false);
          break;
        case "room-full":
          addLog('system', 'error', "$ error: room is full");
          break;
        case "error":
          addLog('system', 'error', `$ error: ${message.message}`);
          break;
      }
    });

    if (initialId === "new") {
      signaling.createRoom();
    } else {
      setRoomId(initialId);
      setRole("joiner");
      addLog('system', 'waiting', `$ joining room ${initialId}...`);
      signaling.joinRoom(initialId);
      connectionRef.current = new WebRTCConnection(signaling, initialId, "joiner", {
        onDataChannelOpen: setupChannel,
        onConnectionStateChange: (state) => addLog('connection', 'system', `$ connection: ${state}`),
        onStatsUpdate: (s) => setStats(s),
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

  const copyShareLink = () => {
    if (!roomId) return;
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const LogSection = ({ title, category }: { title: string, category: keyof typeof expandedSections }) => {
    const sectionLogs = logs.filter(l => l.category === category);
    if (sectionLogs.length === 0) return null;
    const expanded = expandedSections[category];

    return (
      <div className="mb-4 font-mono text-sm">
        <button onClick={() => toggleSection(category)} className="flex items-center text-term-dim hover:text-term-fg transition-colors outline-none">
          <span className="mr-2 text-xs">{expanded ? "▼" : "▶"}</span>
          <span className="font-bold">[{title}]</span>
        </button>
        <div className={`overflow-hidden transition-all duration-300 ${expanded ? 'max-h-screen opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
          <div className="space-y-1 border-l border-term-border pl-4 ml-1">
            {sectionLogs.map(log => (
              <p key={log.id} className={`${TYPE_COLORS[log.type]} animate-fade-in opacity-90`}>
                {log.message}
              </p>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <main className="flex h-screen w-screen">
      <TerminalWindow title={roomId ? `room ${roomId} — zsh` : "connecting — zsh"}>
        
        {roomId && (
          <button
            onClick={() => router.push('/')}
            className="absolute top-4 right-4 text-xs text-term-dim hover:text-term-error transition-colors font-mono"
          >
            [ LEAVE_ROOM ]
          </button>
        )}

        {roomId && (
          <div className="mb-8 p-4 border border-term-action rounded bg-term-bg box-shadow-glow flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 animate-fade-in group">
            <div>
              <p className="text-term-dim text-xs mb-1 font-mono">SESSION ACTIVE. ROOM CODE:</p>
              <p className="text-term-action font-bold text-shadow-glow text-lg font-mono">{roomId}</p>
            </div>
            <button
              onClick={copyShareLink}
              className="whitespace-nowrap px-4 py-2 border border-term-action text-term-action rounded hover:bg-term-action hover:text-term-bg hover:box-shadow-glow transition-all font-mono text-sm"
            >
              {copied ? "[ COPIED ]" : "COPY CODE"}
            </button>
          </div>
        )}

        <div className="mb-20">
          <LogSection title="SYSTEM MESSAGES" category="system" />
          <LogSection title="CONNECTION STATUS" category="connection" />
          <LogSection title="FILE TRANSFERS" category="transfer" />
        </div>

        {/* Fixed bottom area */}
        <div className="sticky bottom-[-1.5rem] -mx-6 px-6 pb-6 pt-4 bg-term-panel/95 backdrop-blur border-t border-term-border flex flex-col gap-4 mt-auto">
          <FileDropzone onFilesSelected={handleFilesSelected} disabled={!channelOpen} />

          {stats && <StatsOverlay stats={stats} />}

          {transfer && (
            <TransferProgress
              fileName={transfer.fileName}
              percent={transfer.percent}
              bytesTransferred={transfer.bytesTransferred}
              totalBytes={transfer.totalBytes}
              speedBytesPerSec={transfer.speed}
            />
          )}

          {receivedFiles.length > 0 && (
            <div className="text-sm font-mono animate-fade-in">
              <p className="mb-2 text-term-magenta font-bold text-shadow-glow">📂 RECEIVED FILES:</p>
              <div className="max-h-32 overflow-y-auto space-y-1 pl-4 border-l border-term-magenta">
                {receivedFiles.map((name) => (
                  <div key={name} className="text-term-action flex items-center animate-fade-in opacity-90">
                    <span className="mr-2">✔</span>
                    <span>{name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      </TerminalWindow>
    </main>
  );
}