import { PrivyProvider, usePrivy, useSignMessage, useWallets } from "@privy-io/react-auth";
import { createContext, type ReactNode, useContext } from "react";
import { hederaTestnet } from "viem/chains";

export type PrivySession = {
  authenticated: boolean;
  configured: boolean;
  ready: boolean;
  userId: string | null;
  walletAddress: string | null;
  login: () => void;
  logout: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  signMessage: (message: string) => Promise<string>;
};

const unavailableSession: PrivySession = {
  authenticated: false,
  configured: false,
  ready: true,
  userId: null,
  walletAddress: null,
  login: () => undefined,
  logout: async () => undefined,
  getAccessToken: async () => null,
  signMessage: async () => { throw new Error("Privy login is not configured"); },
};

const PrivySessionContext = createContext<PrivySession>(unavailableSession);
// Privy app IDs are public browser identifiers. Render may build this manually
// configured service without applying render.yaml, so keep the deployed app ID
// as a safe fallback; the app secret remains server-only.
const DEPLOYED_PRIVY_APP_ID = "cmtyhw5k700fo0cia82y7o5pg";

function PrivySessionBridge({ children }: { children: ReactNode }) {
  const { authenticated, getAccessToken, login, logout, ready, user } = usePrivy();
  const { signMessage } = useSignMessage();
  const { wallets } = useWallets();
  const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === "privy");
  const walletAddress = embeddedWallet?.address ?? user?.wallet?.address ?? null;

  return (
    <PrivySessionContext.Provider
      value={{
        authenticated,
        configured: true,
        ready,
        userId: user?.id ?? null,
        walletAddress,
        login,
        logout,
        getAccessToken,
        signMessage: async (message) => {
          if (!embeddedWallet) throw new Error("Privy embedded wallet is still provisioning");
          const result = await signMessage(
            { message },
            { address: embeddedWallet.address, uiOptions: { title: "Authorize one bounded clearance" } },
          );
          return result.signature;
        },
      }}
    >
      {children}
    </PrivySessionContext.Provider>
  );
}

export function PrivyAuthProvider({ children }: { children: ReactNode }) {
  const appId = import.meta.env.VITE_PRIVY_APP_ID?.trim() || DEPLOYED_PRIVY_APP_ID;

  if (!appId) {
    return <PrivySessionContext.Provider value={unavailableSession}>{children}</PrivySessionContext.Provider>;
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: "light",
          accentColor: "#0f172a",
          logo: "/favicon.svg",
          showWalletLoginFirst: false,
          walletChainType: "ethereum-only",
        },
        defaultChain: hederaTestnet,
        supportedChains: [hederaTestnet],
        loginMethods: ["email", "google", "wallet"],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
      }}
    >
      <PrivySessionBridge>{children}</PrivySessionBridge>
    </PrivyProvider>
  );
}

export function PrivySessionProvider({ children, value }: { children: ReactNode; value: PrivySession }) {
  return <PrivySessionContext.Provider value={value}>{children}</PrivySessionContext.Provider>;
}

export function usePrivySession() {
  return useContext(PrivySessionContext);
}
