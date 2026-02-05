import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

interface ServiceTitanAuthContextType {
  isUnlocked: boolean;
  unlock: (password: string) => Promise<boolean>;
  lock: () => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
}

const ServiceTitanAuthContext = createContext<ServiceTitanAuthContextType | null>(null);

const STORAGE_KEY = "servicetitan_unlocked";

export function ServiceTitanAuthProvider({ children }: { children: ReactNode }) {
  const [isUnlocked, setIsUnlocked] = useState(() => {
    return sessionStorage.getItem(STORAGE_KEY) === "true";
  });

  const unlock = async (password: string): Promise<boolean> => {
    try {
      const response = await fetch("/api/admin/verify-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = await response.json();
      if (result.valid) {
        setIsUnlocked(true);
        sessionStorage.setItem(STORAGE_KEY, "true");
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const lock = () => {
    setIsUnlocked(false);
    sessionStorage.removeItem(STORAGE_KEY);
  };

  const changePassword = async (currentPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch("/api/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = await response.json();
      return result;
    } catch {
      return { success: false, error: "Failed to change password" };
    }
  };

  return (
    <ServiceTitanAuthContext.Provider value={{ isUnlocked, unlock, lock, changePassword }}>
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
