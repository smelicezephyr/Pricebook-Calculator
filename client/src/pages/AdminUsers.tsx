import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth, type CurrentUser } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Shield, Users, Trash2 } from "lucide-react";
import type { Tenant } from "@shared/schema";

function roleBadgeVariant(role: string) {
  if (role === "admin") return "default";
  if (role === "user") return "secondary";
  return "outline";
}

function getInitials(name: string) {
  return name.split(" ").map(p => p[0]).join("").toUpperCase().slice(0, 2);
}

export default function AdminUsers() {
  const { isAdmin, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [savingUsers, setSavingUsers] = useState<Set<number>>(new Set());
  const [isClearingHistory, setIsClearingHistory] = useState(false);

  const { data: users = [], isLoading: usersLoading } = useQuery<CurrentUser[]>({
    queryKey: ["/api/admin/users"],
    enabled: isAdmin,
  });

  const { data: tenants = [], isLoading: tenantsLoading } = useQuery<Tenant[]>({
    queryKey: ["/api/tenants"],
    enabled: isAdmin,
  });

  // Per-user tenant access state (loaded separately)
  const [userTenantIds, setUserTenantIds] = useState<Record<number, number[]>>({});

  const { data: allUserTenants } = useQuery<Record<number, number[]>>({
    queryKey: ["/api/admin/user-tenant-map"],
    enabled: isAdmin && users.length > 0,
    queryFn: async () => {
      const map: Record<number, number[]> = {};
      await Promise.all(
        users.map(async (u) => {
          const res = await fetch(`/api/admin/users/${u.id}/tenants`, { credentials: "include" });
          if (res.ok) map[u.id] = await res.json();
        })
      );
      return map;
    },
  });

  // Sync fetched tenant access into local state
  const resolvedTenantIds = (userId: number) =>
    userTenantIds[userId] ?? allUserTenants?.[userId] ?? [];

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: number; role: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${userId}/role`, { role });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update role", variant: "destructive" });
    },
  });

  const updateTenantsMutation = useMutation({
    mutationFn: async ({ userId, tenantIds }: { userId: number; tenantIds: number[] }) => {
      await apiRequest("PUT", `/api/admin/users/${userId}/tenants`, { tenantIds });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update tenant access", variant: "destructive" });
    },
  });

  const handleRoleChange = (userId: number, role: string) => {
    setSavingUsers(prev => new Set(prev).add(userId));
    updateRoleMutation.mutate({ userId, role }, {
      onSettled: () => setSavingUsers(prev => { const s = new Set(prev); s.delete(userId); return s; }),
    });
  };

  const handleTenantToggle = async (userId: number, tenantId: number, checked: boolean) => {
    const current = resolvedTenantIds(userId);
    const next = checked ? [...current, tenantId] : current.filter(id => id !== tenantId);
    setUserTenantIds(prev => ({ ...prev, [userId]: next }));
    updateTenantsMutation.mutate({ userId, tenantIds: next });
  };

  const handleClearHistory = async () => {
    setIsClearingHistory(true);
    try {
      const res = await fetch("/api/admin/clear-history", { method: "DELETE", credentials: "include" });
      const result = await res.json();
      if (result.success) {
        toast({ title: "Cleared", description: "All quote history has been removed" });
        queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      } else {
        toast({ title: "Error", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to clear history", variant: "destructive" });
    } finally {
      setIsClearingHistory(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin w-6 h-6 text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full p-8 text-muted-foreground">
        Admin access required.
      </div>
    );
  }

  const isLoading = usersLoading || tenantsLoading;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield size={22} />
            User Management
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage roles and tenant access for everyone who has signed in.
          </p>
        </div>
      </div>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users size={16} />
            Signed-in Users ({users.length})
          </CardTitle>
          <CardDescription>
            New sign-ins default to the <strong>everyone</strong> role (calculator only). Promote to <strong>user</strong> and assign tenants to grant ServiceTitan access, or promote to <strong>admin</strong> for full access.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-6 justify-center">
              <Loader2 className="animate-spin w-4 h-4" />
              Loading users...
            </div>
          ) : users.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-6">No users yet.</p>
          ) : (
            <div className="space-y-3">
              {users.map((u) => {
                const isSaving = savingUsers.has(u.id);
                const isUser = u.role === "user";
                const tenantIds = resolvedTenantIds(u.id);
                return (
                  <div
                    key={u.id}
                    className="border border-border rounded-xl p-4 space-y-3"
                    data-testid={`user-row-${u.id}`}
                  >
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      {/* Identity */}
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar className="w-9 h-9 shrink-0">
                          <AvatarImage src={u.avatarUrl ?? undefined} alt={u.name} />
                          <AvatarFallback className="text-xs">{getInitials(u.name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate" data-testid={`text-user-name-${u.id}`}>{u.name}</p>
                          <p className="text-xs text-muted-foreground truncate" data-testid={`text-user-email-${u.id}`}>{u.email}</p>
                        </div>
                      </div>

                      {/* Role selector */}
                      <div className="flex items-center gap-2">
                        <Badge variant={roleBadgeVariant(u.role)} className="capitalize text-xs">
                          {u.role}
                        </Badge>
                        <Select
                          value={u.role}
                          onValueChange={(role) => handleRoleChange(u.id, role)}
                          disabled={isSaving}
                        >
                          <SelectTrigger
                            className="h-8 w-32 text-xs"
                            data-testid={`select-role-${u.id}`}
                          >
                            {isSaving ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <SelectValue />
                            )}
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="everyone">Everyone</SelectItem>
                            <SelectItem value="user">User</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Tenant access (only shown when role is "user") */}
                    {isUser && (
                      <div className="pl-12 space-y-2">
                        <p className="text-xs text-muted-foreground font-medium">Tenant Access</p>
                        {tenants.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No tenants configured yet.</p>
                        ) : (
                          <div className="flex flex-wrap gap-3">
                            {tenants.map((t) => {
                              const checked = tenantIds.includes(t.id);
                              return (
                                <label
                                  key={t.id}
                                  className="flex items-center gap-2 cursor-pointer text-sm"
                                  data-testid={`checkbox-tenant-${u.id}-${t.id}`}
                                >
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(c) => handleTenantToggle(u.id, t.id, !!c)}
                                  />
                                  {t.name}
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
          <CardDescription>These actions are permanent and cannot be undone.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Clear all quote history</p>
              <p className="text-xs text-muted-foreground">Permanently deletes all saved quotes.</p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={isClearingHistory} data-testid="button-clear-history">
                  {isClearingHistory ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  <span className="ml-1">Clear History</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear all quote history?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes every saved quote. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleClearHistory}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    data-testid="button-confirm-clear-history"
                  >
                    Delete All
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
