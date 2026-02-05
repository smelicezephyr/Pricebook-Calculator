import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

interface ServiceTitanAuthContextType {
  isUnlocked: boolean;
  isLoading: boolean;
  unlock: (password: string) => Promise<boolean>;
  lock: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
}

const ServiceTitanAuthContext = createContext<ServiceTitanAuthContextType | null>(null);

export function ServiceTitanAuthProvider({ children }: { children: ReactNode }) {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Check auth status with server on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch("/api/admin/check-auth");
        const result = await response.json();
        setIsUnlocked(result.unlocked);
      } catch {
        setIsUnlocked(false);
      } finally {
        setIsLoading(false);
      }
    };
    checkAuth();
  }, []);

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
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const lock = async () => {
    try {
      await fetch("/api/admin/lock", { method: "POST" });
    } catch {
      // Ignore errors
    }
    setIsUnlocked(false);
  };

  const changePassword = async (currentPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch("/api/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = await response.json();
      if (result.success) {
        // Password changed, user will be locked out
        setIsUnlocked(false);
      }
      return result;
    } catch {
      return { success: false, error: "Failed to change password" };
    }
  };

  return (
    <ServiceTitanAuthContext.Provider value={{ isUnlocked, isLoading, unlock, lock, changePassword }}>
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
