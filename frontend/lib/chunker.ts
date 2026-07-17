// Phase 3: chunking (sender side) and reassembly (receiver side) protocol,
// layered on top of an already-open RTCDataChannel from Phase 2. See
// project_context.md section 4 for the full protocol description.

const CHUNK_SIZE = 16 * 1024; // 16KB — conservative, cross-browser-safe convention
const BUFFERED_AMOUNT_HIGH_THRESHOLD = 1024 * 1024; // pause sending above 1MB queued
const BUFFERED_AMOUNT_LOW_THRESHOLD = 256 * 1024; // resume once queued drops below this

export interface FileStartMessage {
  type: "file-start";
  fileName: string;
  fileSize: number;
  totalChunks: number;
  mimeType: string;
}

export interface FileEndMessage {
  type: "file-end";
  fileName: string;
}

export type FileControlMessage = FileStartMessage | FileEndMessage;

export interface TransferProgressEvent {
  fileName: string;
  bytesTransferred: number;
  totalBytes: number;
}

export interface FileSenderCallbacks {
  onProgress?: (event: TransferProgressEvent) => void;
  onFileComplete?: (fileName: string) => void;
  onAllComplete?: () => void;
}

// Sends one or more files sequentially over an already-open data channel,
// respecting backpressure via bufferedAmount so a large file can't queue
// unbounded data into the channel's internal send buffer.
export class FileSender {
  private channel: RTCDataChannel;
  private callbacks: FileSenderCallbacks;
  private queue: File[] = [];
  private sending = false;

  constructor(channel: RTCDataChannel, callbacks: FileSenderCallbacks = {}) {
    this.channel = channel;
    this.callbacks = callbacks;
    this.channel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW_THRESHOLD;
  }

  // Queue one or more files. If nothing is currently sending, starts immediately.
  enqueue(files: FileList | File[]) {
    this.queue.push(...Array.from(files));
    if (!this.sending) {
      void this.processQueue();
    }
  }

  private async processQueue() {
    this.sending = true;
    while (this.queue.length > 0) {
      const file = this.queue.shift()!;
      await this.sendFile(file);
    }
    this.sending = false;
    this.callbacks.onAllComplete?.();
  }

  private waitForBufferLow(): Promise<void> {
    if (this.channel.bufferedAmount <= BUFFERED_AMOUNT_HIGH_THRESHOLD) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const handler = () => {
        this.channel.removeEventListener("bufferedamountlow", handler);
        resolve();
      };
      this.channel.addEventListener("bufferedamountlow", handler);
    });
  }

  private async sendFile(file: File) {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    const startMessage: FileStartMessage = {
      type: "file-start",
      fileName: file.name,
      fileSize: file.size,
      totalChunks,
      mimeType: file.type || "application/octet-stream",
    };
    this.channel.send(JSON.stringify(startMessage));

    let offset = 0;
    while (offset < file.size) {
      await this.waitForBufferLow();

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();
      this.channel.send(buffer);

      offset += buffer.byteLength;
      this.callbacks.onProgress?.({
        fileName: file.name,
        bytesTransferred: offset,
        totalBytes: file.size,
      });
    }

    const endMessage: FileEndMessage = { type: "file-end", fileName: file.name };
    this.channel.send(JSON.stringify(endMessage));
    this.callbacks.onFileComplete?.(file.name);
  }
}

export interface FileReceiverCallbacks {
  onProgress?: (event: TransferProgressEvent) => void;
  onFileReceived?: (file: Blob, fileName: string) => void;
}

// Reassembles incoming chunks into complete files. Listens via addEventListener
// (rather than assigning channel.onmessage directly) so it composes cleanly with
// any other "message" listener already attached to the same channel (e.g. from
// lib/webrtc.ts), instead of silently overwriting it.
export class FileReceiver {
  private callbacks: FileReceiverCallbacks;
  private currentFile: FileStartMessage | null = null;
  private receivedChunks: ArrayBuffer[] = [];
  private receivedBytes = 0;

  constructor(channel: RTCDataChannel, callbacks: FileReceiverCallbacks = {}) {
    this.callbacks = callbacks;
    channel.binaryType = "arraybuffer";
    channel.addEventListener("message", (event) => this.handleMessage(event));
  }

  private handleMessage(event: MessageEvent) {
    if (typeof event.data === "string") {
      const message: FileControlMessage = JSON.parse(event.data);
      if (message.type === "file-start") {
        this.currentFile = message;
        this.receivedChunks = [];
        this.receivedBytes = 0;
      } else if (message.type === "file-end") {
        this.finalizeFile();
      }
      return;
    }

    // Binary chunk.
    const buffer = event.data as ArrayBuffer;
    this.receivedChunks.push(buffer);
    this.receivedBytes += buffer.byteLength;

    if (this.currentFile) {
      this.callbacks.onProgress?.({
        fileName: this.currentFile.fileName,
        bytesTransferred: this.receivedBytes,
        totalBytes: this.currentFile.fileSize,
      });
    }
  }

  private finalizeFile() {
    if (!this.currentFile) return;
    const blob = new Blob(this.receivedChunks, { type: this.currentFile.mimeType });
    this.callbacks.onFileReceived?.(blob, this.currentFile.fileName);

    this.currentFile = null;
    this.receivedChunks = [];
    this.receivedBytes = 0;
  }
}

// Triggers a browser download for a received Blob.
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}