import type { AppProps } from "next/app";
import { Fira_Code } from "next/font/google";
import "../styles/globals.css";

const firaCode = Fira_Code({ subsets: ["latin"] });

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div className={`${firaCode.className} font-mono`}>
      <Component {...pageProps} />
    </div>
  );
}
