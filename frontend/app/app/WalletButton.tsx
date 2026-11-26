"use client";

import { ConnectKitButton, useModal } from "connectkit";

export default function WalletButton() {
  const { openSwitchNetworks } = useModal();

  return (
    <div className="app-wallet-control">
      <ConnectKitButton.Custom>
        {({ isConnected, isConnecting, unsupported, show, truncatedAddress, address }) => (
          <button
            className="app-wallet-button"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={isConnecting}
            title={address}
            onClick={isConnected && unsupported ? openSwitchNetworks : show}
          >
            {isConnected ? unsupported ? "Switch network" : truncatedAddress : "Connect wallet"}
          </button>
        )}
      </ConnectKitButton.Custom>
    </div>
  );
}
