"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectKitProvider } from "connectkit";
import { useEffect, useState, type ReactNode } from "react";
import { createConfig, http, WagmiProvider } from "wagmi";
import { bsc } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();

const config = createConfig({
  chains: [bsc],
  transports: { [bsc.id]: http() },
  connectors: [
    injected(),
    ...(projectId ? [walletConnect({
      projectId,
      showQrModal: false,
      metadata: {
        name: "Dawn Finance",
        description: "Tokenized stock lending simulator",
        url: "https://dawn-finance.vercel.app",
        icons: [],
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
  "--ck-focus-color": "var(--dawn-app-blue)",
  "--ck-body-color": "var(--dawn-app-ink)",
  "--ck-body-color-muted": "var(--dawn-app-muted)",
  "--ck-body-action-color": "var(--dawn-app-muted)",
  "--ck-body-background": "var(--dawn-app-paper)",
  "--ck-body-background-secondary": "var(--dawn-app-sheet)",
  "--ck-body-disclaimer-background": "var(--dawn-app-sheet)",
  "--ck-body-disclaimer-color": "var(--dawn-app-muted)",
};

const options = {
  disclaimer: "Wallet connection is optional. App balances and actions are simulated.",
  hideBalance: true,
};

export default function WalletProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
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
