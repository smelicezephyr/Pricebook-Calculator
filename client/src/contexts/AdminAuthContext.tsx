import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

interface AdminAuthContextType {
  isUnlocked: boolean;
  isLoading: boolean;
  unlock: (pin: string) => Promise<boolean>;
  lock: () => Promise<void>;
  changePin: (currentPin: string, newPin: string) => Promise<{ success: boolean; error?: string }>;
}

const AdminAuthContext = createContext<AdminAuthContextType | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch("/api/admin/check-pin-auth");
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

  const unlock = async (pin: string): Promise<boolean> => {
    try {
      const response = await fetch("/api/admin/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
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
      await fetch("/api/admin/lock-pin", { method: "POST" });
    } catch {
      // Ignore errors
    }
    setIsUnlocked(false);
  };

  const changePin = async (currentPin: string, newPin: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch("/api/admin/change-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPin, newPin }),
      });
      const result = await response.json();
      if (result.success) {
        setIsUnlocked(false);
      }
      return result;
    } catch {
      return { success: false, error: "Failed to change PIN" };
    }
  };

  return (
    <AdminAuthContext.Provider value={{ isUnlocked, isLoading, unlock, lock, changePin }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);
  if (!context) {
    throw new Error("useAdminAuth must be used within AdminAuthProvider");
  }
  return context;
}
