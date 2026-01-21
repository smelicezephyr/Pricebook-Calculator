import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

interface ServiceTitanAuthContextType {
  isUnlocked: boolean;
  unlock: (password: string) => boolean;
  lock: () => void;
}

const ServiceTitanAuthContext = createContext<ServiceTitanAuthContextType | null>(null);

const CORRECT_PASSWORD = "ZephyrHome160";
const STORAGE_KEY = "servicetitan_unlocked";

export function ServiceTitanAuthProvider({ children }: { children: ReactNode }) {
  const [isUnlocked, setIsUnlocked] = useState(() => {
    return sessionStorage.getItem(STORAGE_KEY) === "true";
  });

  const unlock = (password: string): boolean => {
    if (password === CORRECT_PASSWORD) {
      setIsUnlocked(true);
      sessionStorage.setItem(STORAGE_KEY, "true");
      return true;
    }
    return false;
  };

  const lock = () => {
    setIsUnlocked(false);
    sessionStorage.removeItem(STORAGE_KEY);
  };

  return (
    <ServiceTitanAuthContext.Provider value={{ isUnlocked, unlock, lock }}>
      {children}
    </ServiceTitanAuthContext.Provider>
  );
}

export function useServiceTitanAuth() {
  const context = useContext(ServiceTitanAuthContext);
  if (!context) {
    throw new Error("useServiceTitanAuth must be used within ServiceTitanAuthProvider");
  }
  return context;
}
