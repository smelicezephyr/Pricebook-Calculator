import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

export interface CurrentUser {
  id: number;
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: "everyone" | "user" | "admin";
  createdAt: string | null;
}

interface AuthContextType {
  user: CurrentUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isUserOrAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

// AUTH TEMPORARILY DISABLED — restore the useQuery block and remove the mock below when Google OAuth is re-enabled.
const MOCK_ADMIN: CurrentUser = {
  id: 0,
  googleId: "",
  email: "",
  name: "Admin",
  avatarUrl: null,
  role: "admin",
  createdAt: null,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  // AUTH TEMPORARILY DISABLED
  const resolvedUser = MOCK_ADMIN;

  // Restore this block when Google OAuth is re-enabled:
  // const { data: user, isLoading } = useQuery<CurrentUser | null>({
  //   queryKey: ["/api/auth/me"],
  //   queryFn: async () => {
  //     const res = await fetch("/api/auth/me", { credentials: "include" });
  //     if (res.status === 401) return null;
  //     if (!res.ok) return null;
  //     return res.json();
  //   },
  //   staleTime: 60_000,
  //   retry: false,
  // });
  // const resolvedUser = user ?? null;

  return (
    <AuthContext.Provider
      value={{
        user: resolvedUser,
        isLoading: false,
        isAuthenticated: true,
        isAdmin: true,
        isUserOrAdmin: true,
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
