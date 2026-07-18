import type { ConnectionStats } from "../lib/webrtc";

interface StatsOverlayProps {
  stats: ConnectionStats | null;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "--";
  if (bytes < 1024) return `${bytes}B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB/s`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB/s`;
}

// Phase 5a: live connection stats panel. Reads from RTCPeerConnection.getStats()
// via the WebRTCConnection.onStatsUpdate callback, polled every second.
// On localhost, connectionType will read "host" — this is correct and expected
// behaviour for same-machine tabs, not a bug.
export default function StatsOverlay({ stats }: StatsOverlayProps) {
  if (!stats) return null;

  const { rttMs, connectionType, bytesPerSec } = stats;

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs text-term-dim border-t border-term-border pt-3">
      <span>
        <span className="text-term-action">RTT:</span>{" "}
        {rttMs !== null ? `${rttMs}ms` : "--"}
      </span>
      <span>
        <span className="text-term-action">TYPE:</span>{" "}
        <span
          className={
            connectionType === "relay"
              ? "text-term-waiting"
              : connectionType === "srflx"
              ? "text-term-system"
              : connectionType
              ? "text-term-action"
              : ""
          }
        >
          {connectionType ?? "--"}
          {connectionType === "host" && (
            <span className="text-term-dim text-[10px]"> (same-machine)</span>
          )}
        </span>
      </span>
      <span>
        <span className="text-term-action">SPEED:</span>{" "}
        {formatBytes(bytesPerSec)}
      </span>
    </div>
  );
}
