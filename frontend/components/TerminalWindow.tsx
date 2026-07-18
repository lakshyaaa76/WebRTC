import { ReactNode, useEffect, useState } from "react";

interface TerminalWindowProps {
  title: string;
  children: ReactNode;
}

const THEMES = ["cyan", "green", "amber"] as const;
type Theme = typeof THEMES[number];

const ASCII_BANNER = `
  _____  ___  _____ 
 |  __ \\|__ \\|  __ \\
 | |__) |  ) | |__) |
 |  ___/  / /|  ___/ 
 | |     / /_| |    
 |_|    |____|_|    
                    
 TRANSFER PROTOCOL
`;

export default function TerminalWindow({ title, children }: TerminalWindowProps) {
  const [theme, setTheme] = useState<Theme>("cyan");

  useEffect(() => {
    const saved = localStorage.getItem("term-theme") as Theme;
    if (saved && THEMES.includes(saved)) {
      setTheme(saved);
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("term-theme", theme);
  }, [theme]);

  const cycleTheme = () => {
    const nextIndex = (THEMES.indexOf(theme) + 1) % THEMES.length;
    setTheme(THEMES[nextIndex]);
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-term-panel text-term-fg transition-colors duration-500">
      <div className="flex items-center justify-between border-b border-term-border bg-term-bg px-4 py-2 transition-colors duration-500">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-[#F7768E]" />
          <span className="h-3 w-3 rounded-full bg-[#E0AF68]" />
          <span className="h-3 w-3 rounded-full bg-[#9ECE6A]" />
          <span className="ml-2 truncate text-xs text-term-dim">{title}</span>
        </div>
        <button
          onClick={cycleTheme}
          className="text-xs text-term-dim transition-colors hover:text-term-action hover:text-shadow-glow"
        >
          [theme: {theme}]
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-6 relative">
        <div className="flex justify-center w-full">
          <pre className="mb-6 text-[10px] sm:text-xs text-term-magenta text-shadow-glow leading-tight opacity-80">
            {ASCII_BANNER}
          </pre>
        </div>
        {children}
      </div>
    </div>
  );
}