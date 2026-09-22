import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getCurrentAccount, logout as apiLogout, type Account } from "../api/accountClient";

interface AccountContextValue {
  /** undefined while the initial /api/account/me check is in flight, null
   * once it's confirmed nobody's signed in. */
  account: Account | null | undefined;
  setAccount: (account: Account | null) => void;
  logout: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);

  useEffect(() => {
    getCurrentAccount().then(setAccount, () => setAccount(null));
  }, []);

  async function logout() {
    await apiLogout();
    setAccount(null);
  }

  return (
    <AccountContext.Provider value={{ account, setAccount, logout }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used within an AccountProvider");
  return ctx;
}
