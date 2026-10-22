import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

const AUTH_MARKER_KEY = "pricebookcalc.authenticated";

export function clearAuthSessionMarker() {
  try {
    window.sessionStorage.removeItem(AUTH_MARKER_KEY);
  } catch {
    // Session storage may be unavailable in hardened browser contexts.
  }
}

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
  isPriceGated: boolean;
  isEveryone: boolean;
  authCheckFailed: boolean;
  sessionExpired: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: user, isLoading, error } = useQuery<CurrentUser | null>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error("Unable to check your sign-in session");
      return res.json();
    },
    staleTime: 60_000,
    retry: false,
  });

  const resolvedUser = user ?? null;
  const authCheckFailed = !isLoading && Boolean(error);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    try {
      if (resolvedUser) {
        window.sessionStorage.setItem(AUTH_MARKER_KEY, "1");
        setSessionExpired(false);
      } else {
        setSessionExpired(window.sessionStorage.getItem(AUTH_MARKER_KEY) === "1");
      }
    } catch {
      setSessionExpired(false);
    }
  }, [isLoading, resolvedUser]);

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
        isPriceGated: resolvedUser?.role === "everyone" || resolvedUser?.role === "user",
        isEveryone: resolvedUser?.role === "everyone",
        authCheckFailed,
        sessionExpired,
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
