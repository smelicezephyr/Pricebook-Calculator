import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

export interface CurrentUser {
  id: number;
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: "everyone" | "user" | "manager" | "admin";
  pushPermission: "both" | "reprice_only" | "add_new_only";
  emailNotifications: boolean;
  createdAt: string | null;
}

interface AuthContextType {
  user: CurrentUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isManager: boolean;
  isUserOrAdmin: boolean;
  isReporting: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: user, isLoading } = useQuery<CurrentUser | null>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.status === 401) return null;
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
    retry: false,
  });

  const resolvedUser = user ?? null;

  return (
    <AuthContext.Provider
      value={{
        user: resolvedUser,
        isLoading,
        isAuthenticated: !!resolvedUser,
        isAdmin: resolvedUser?.role === "admin",
        isManager: resolvedUser?.role === "manager",
        isUserOrAdmin: resolvedUser?.role === "user" || resolvedUser?.role === "manager" || resolvedUser?.role === "admin",
        isReporting: resolvedUser?.role === "admin" || resolvedUser?.role === "manager",
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
