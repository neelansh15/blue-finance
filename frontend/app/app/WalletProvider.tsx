"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectKitProvider } from "connectkit";
import { useEffect, useState, type ReactNode } from "react";
import { createConfig, http, WagmiProvider } from "wagmi";
import { bsc } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { BSC_RPC_URL } from "../../src/lib/blue/mainnet";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();

const config = createConfig({
  chains: [bsc],
  transports: { [bsc.id]: http(BSC_RPC_URL) },
  connectors: [
    injected(),
    ...(projectId ? [walletConnect({
      projectId,
      showQrModal: false,
      metadata: {
        name: "Blue Finance",
        description: "Tokenized stock lending on BNB Smart Chain",
        url: "https://blue-finance.vercel.app",
        icons: ["https://blue-finance.vercel.app/assets/brand/blue-finance-mark.png"],
      },
    })] : []),
  ],
  ssr: true,
});

const theme = {
  "--ck-border-radius": "0px",
  "--ck-primary-button-border-radius": "0px",
  "--ck-secondary-button-border-radius": "0px",
  "--ck-qr-border-radius": "0px",
  "--ck-font-family": "var(--font)",
  "--ck-focus-color": "var(--blue-app-blue)",
  "--ck-body-color": "var(--blue-app-ink)",
  "--ck-body-color-muted": "var(--blue-app-muted)",
  "--ck-body-action-color": "var(--blue-app-muted)",
  "--ck-body-background": "var(--blue-app-paper)",
  "--ck-body-background-secondary": "var(--blue-app-sheet)",
  "--ck-body-disclaimer-background": "var(--blue-app-sheet)",
  "--ck-body-disclaimer-color": "var(--blue-app-muted)",
};

const options = {
  disclaimer: "The onchain workspace uses real tokens and gas. Simulator actions stay in the browser.",
  hideBalance: true,
};

export default function WalletProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, retry: false } },
  }));
  const [mode, setMode] = useState<"light" | "dark" | "auto">("auto");

  useEffect(() => {
    const root = document.documentElement;
    function syncTheme() {
      const theme = root.dataset.theme;
      setMode(theme === "dark" || theme === "light" ? theme : "auto");
    }
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider
          theme="auto"
          mode={mode}
          customTheme={theme}
          options={options}
        >
          {children}
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
