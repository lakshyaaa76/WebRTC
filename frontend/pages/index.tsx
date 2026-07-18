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
          <span className="text-term-action">{">"}</span> direct, encrypted, browser-to-browser file transfer.
          <br /><span className="text-term-action">{">"}</span> no file ever touches a server.
        </p>

        <div className="mb-10">
          <p className="mb-3 text-term-action font-bold text-shadow-glow"># Initialize new session</p>
          <button
            onClick={handleCreateRoom}
            disabled={creating}
            className="group relative rounded border border-term-action bg-term-bg px-6 py-3 text-term-action transition-all duration-300 hover:box-shadow-glow disabled:opacity-50"
          >
            <div className="flex items-center gap-2">
              <span>{creating ? "[creating...]" : "./create_room.sh"}</span>
              {!creating && <span className="w-2 h-4 bg-term-action opacity-0 group-hover:opacity-100 animate-blink inline-block" />}
            </div>
          </button>
        </div>

        <div>
          <p className="mb-3 text-term-magenta font-bold text-shadow-glow"># Join existing session</p>
          <form onSubmit={handleJoinRoom} className="flex flex-col sm:flex-row gap-3">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-term-magenta">{">"}</span>
              <input
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value)}
                placeholder="CODE"
                maxLength={6}
                className="w-40 rounded border border-term-border bg-term-bg pl-8 pr-3 py-3 uppercase tracking-widest text-term-fg placeholder-term-dim outline-none transition-all focus:border-term-magenta focus:box-shadow-glow"
              />
            </div>
            <button
              type="submit"
              className="rounded border border-term-magenta px-6 py-3 text-term-magenta transition-all duration-300 hover:bg-term-magenta hover:text-term-bg hover:box-shadow-glow"
            >
              Execute
            </button>
          </form>
          {joinError && <p className="mt-3 text-sm text-term-error text-shadow-glow animate-fade-in">{joinError}</p>}
        </div>
      </TerminalWindow>
    </main>
  );
}