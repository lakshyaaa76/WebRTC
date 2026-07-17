import { FormEvent, useState } from "react";
import { useRouter } from "next/router";
import TerminalWindow from "../components/TerminalWindow";

const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/;

export default function Home() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const handleCreateRoom = () => {
    setCreating(true);
    // The room code itself doesn't exist yet -- /room/new drives the
    // initiator path, which creates the room and updates the URL to the
    // real code once the signaling server responds.
    router.push("/room/new");
  };

  const handleJoinRoom = (event: FormEvent) => {
    event.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!ROOM_CODE_PATTERN.test(code)) {
      setJoinError("error: room code must be 6 letters/numbers");
      return;
    }
    setJoinError(null);
    router.push(`/room/${code}`);
  };

  return (
    <main className="flex h-screen w-screen">
      <TerminalWindow title="p2p-transfer — zsh">
        <p className="mb-6 text-term-dim">
          $ direct, encrypted, browser-to-browser file transfer.
          <br />$ no file ever touches a server.
        </p>

        <div className="mb-8">
          <p className="mb-2 text-term-cyan">$ create-room</p>
          <button
            onClick={handleCreateRoom}
            disabled={creating}
            className="rounded border border-term-cyan px-4 py-2 text-term-cyan transition hover:bg-term-cyan hover:text-term-bg disabled:opacity-50"
          >
            {creating ? "creating..." : "Create Room"}
          </button>
        </div>

        <div>
          <p className="mb-2 text-term-magenta">$ join-room --code</p>
          <form onSubmit={handleJoinRoom} className="flex flex-wrap gap-2">
            <input
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value)}
              placeholder="ABC123"
              maxLength={6}
              className="w-32 rounded border border-term-border bg-term-bg px-3 py-2 uppercase tracking-widest text-term-fg placeholder-term-dim outline-none focus:border-term-magenta"
            />
            <button
              type="submit"
              className="rounded border border-term-magenta px-4 py-2 text-term-magenta transition hover:bg-term-magenta hover:text-term-bg"
            >
              Join Room
            </button>
          </form>
          {joinError && <p className="mt-2 text-sm text-[#F7768E]">{joinError}</p>}
        </div>
      </TerminalWindow>
    </main>
  );
}