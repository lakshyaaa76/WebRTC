import { ReactNode } from "react";

interface TerminalWindowProps {
  title: string;
  children: ReactNode;
}

// Every screen in the app renders inside this frame -- a small, consistent
// piece of chrome (traffic-light dots + title bar) that reinforces the
// terminal register the design brief calls for, without competing with the
// actual signature element (the ASCII progress bar in TransferProgress).
export default function TerminalWindow({ title, children }: TerminalWindowProps) {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-term-panel">
      <div className="flex items-center gap-2 border-b border-term-border bg-term-bg px-4 py-2">
        <span className="h-3 w-3 rounded-full bg-[#F7768E]" />
        <span className="h-3 w-3 rounded-full bg-[#E0AF68]" />
        <span className="h-3 w-3 rounded-full bg-[#9ECE6A]" />
        <span className="ml-2 truncate text-xs text-term-dim">{title}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-6">{children}</div>
    </div>
  );
}