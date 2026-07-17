interface TransferProgressProps {
  fileName: string;
  percent: number;
  bytesTransferred: number;
  totalBytes: number;
  speedBytesPerSec: number;
}

const BAR_WIDTH = 28;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// The signature element of the whole UI: a genuinely terminal-native
// progress bar built from block characters, rather than a themed skin over
// a normal <progress> element or a gradient div.
export default function TransferProgress({
  fileName,
  percent,
  bytesTransferred,
  totalBytes,
  speedBytesPerSec,
}: TransferProgressProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * BAR_WIDTH);
  const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
  const remainingBytes = totalBytes - bytesTransferred;
  const etaSeconds = speedBytesPerSec > 0 ? remainingBytes / speedBytesPerSec : Infinity;

  return (
    <div className="w-full text-sm">
      <p className="mb-1 truncate text-term-cyan">$ transferring {fileName}</p>
      <p className="tabular-nums text-term-magenta">
        [{bar}] {String(clamped).padStart(3, " ")}%
      </p>
      <p className="mt-1 text-term-dim">
        {formatBytes(bytesTransferred)} / {formatBytes(totalBytes)} —{" "}
        {formatBytes(speedBytesPerSec)}/s — ETA {formatEta(etaSeconds)}
      </p>
    </div>
  );
}