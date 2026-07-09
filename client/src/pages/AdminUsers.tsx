import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth, type CurrentUser } from "@/contexts/AuthContext";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Shield, Users, Trash2, ChevronDown, ChevronUp, UserX, RefreshCw } from "lucide-react";
import type { Tenant } from "@shared/schema";

function roleBadgeVariant(role: string) {
  if (role === "admin") return "default";
  if (role === "manager") return "secondary";
  if (role === "user") return "secondary";
  return "outline";
}

function getInitials(name: string) {
  return name.split(" ").map(p => p[0]).join("").toUpperCase().slice(0, 2);
}

export default function AdminUsers() {
  const { isAdmin, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [savingRoles, setSavingRoles] = useState<Set<number>>(new Set());
  const [savingTenants, setSavingTenants] = useState<Set<number>>(new Set());
  const [savingPushPermissions, setSavingPushPermissions] = useState<Set<number>>(new Set());
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const [expandedUsers, setExpandedUsers] = useState<Set<number>>(new Set());
  const [pendingTenantIds, setPendingTenantIds] = useState<Record<number, number[]>>({});

  const { data: users = [], isLoading: usersLoading, refetch: refetchUsers } = useQuery<CurrentUser[]>({
    queryKey: ["/api/admin/users"],
    enabled: isAdmin,
  });

  const roleOrder = { admin: 0, manager: 1, user: 2, everyone: 3 } as const;
  const sortedUsers = [...users].sort((a, b) => roleOrder[a.role] - roleOrder[b.role]);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([
      refetchUsers(),
      queryClient.invalidateQueries({ queryKey: ["/api/admin/user-tenant-map"] }),
    ]);
    setIsRefreshing(false);
  };

  const { data: tenants = [], isLoading: tenantsLoading } = useQuery<Tenant[]>({
    queryKey: ["/api/tenants"],
    enabled: isAdmin,
  });

  const { data: onlineUserIds = [] } = useQuery<number[]>({
    queryKey: ["/api/admin/online-users"],
    enabled: isAdmin,
    refetchInterval: 30_000,
  });

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

  const resolvedTenantIds = (userId: number) =>
    pendingTenantIds[userId] ?? allUserTenants?.[userId] ?? [];

  const isDirty = (userId: number) =>
    pendingTenantIds[userId] !== undefined;

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

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      await apiRequest("DELETE", `/api/admin/users/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/user-tenant-map"] });
      toast({ title: "User removed", description: "The user has been deleted and their access revoked." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete user.", variant: "destructive" });
    },
  });

  const updatePushPermissionMutation = useMutation({
    mutationFn: async ({ userId, pushPermission }: { userId: number; pushPermission: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${userId}/push-permission`, { pushPermission });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Saved", description: "Push access updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update push access.", variant: "destructive" });
    },
  });

  const handlePushPermissionChange = (userId: number, pushPermission: string) => {
    setSavingPushPermissions(prev => new Set(prev).add(userId));
    updatePushPermissionMutation.mutate({ userId, pushPermission }, {
      onSettled: () => setSavingPushPermissions(prev => { const s = new Set(prev); s.delete(userId); return s; }),
    });
  };

  const updateTenantsMutation = useMutation({
    mutationFn: async ({ userId, tenantIds }: { userId: number; tenantIds: number[] }) => {
      await apiRequest("PUT", `/api/admin/users/${userId}/tenants`, { tenantIds });
    },
    onSuccess: (_data, { userId }) => {
      setPendingTenantIds(prev => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/user-tenant-map"] });
      toast({ title: "Saved", description: "Tenant access updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update tenant access", variant: "destructive" });
    },
  });

  const handleRoleChange = (userId: number, role: string) => {
    setSavingRoles(prev => new Set(prev).add(userId));
    updateRoleMutation.mutate({ userId, role }, {
      onSettled: () => setSavingRoles(prev => { const s = new Set(prev); s.delete(userId); return s; }),
    });
  };

  const handleTenantToggle = (userId: number, tenantId: number, checked: boolean) => {
    const current = resolvedTenantIds(userId);
    const next = checked ? [...current, tenantId] : current.filter(id => id !== tenantId);
    setPendingTenantIds(prev => ({ ...prev, [userId]: next }));
  };

  const handleSaveTenants = (userId: number) => {
    const tenantIds = resolvedTenantIds(userId);
    setSavingTenants(prev => new Set(prev).add(userId));
    updateTenantsMutation.mutate({ userId, tenantIds }, {
      onSettled: () => setSavingTenants(prev => { const s = new Set(prev); s.delete(userId); return s; }),
    });
  };

  const toggleExpanded = (userId: number) => {
    setExpandedUsers(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Shield size={22} />
          User Management
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage roles and tenant access for everyone who has signed in.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <Users size={16} />
              Signed-in Users ({users.length})
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground"
              onClick={handleRefresh}
              disabled={isRefreshing || usersLoading}
              data-testid="button-refresh-users"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
            </Button>
          </CardTitle>
          <CardDescription>
            New sign-ins default to the <strong>everyone</strong> role (calculator only). Promote to <strong>user</strong> and assign tenants to grant ServiceTitan access, to <strong>manager</strong> for the same access plus read-only Reporting on their tenant(s), or to <strong>admin</strong> for full access.
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
              {sortedUsers.map((u) => {
                const isRoleSaving = savingRoles.has(u.id);
                const isTenantSaving = savingTenants.has(u.id);
                const isUser = u.role === "user" || u.role === "manager";
                const tenantIds = resolvedTenantIds(u.id);
                const expanded = expandedUsers.has(u.id);
                const dirty = isDirty(u.id);
                const isOnline = onlineUserIds.includes(u.id);

                return (
                  <div
                    key={u.id}
                    className="border border-border rounded-xl p-4 space-y-3"
                    data-testid={`user-row-${u.id}`}
                  >
                    {/* Top row: avatar, name/email, role badge + selector, expand button */}
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative shrink-0">
                          <Avatar className="w-9 h-9">
                            <AvatarImage src={u.avatarUrl ?? undefined} alt={u.name} />
                            <AvatarFallback className="text-xs">{getInitials(u.name)}</AvatarFallback>
                          </Avatar>
                          {isOnline && (
                            <span
                              className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-background"
                              data-testid={`indicator-online-${u.id}`}
                            />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate" data-testid={`text-user-name-${u.id}`}>{u.name}</p>
                          <p className="text-xs text-muted-foreground truncate" data-testid={`text-user-email-${u.id}`}>{u.email}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Badge variant={roleBadgeVariant(u.role)} className="capitalize text-xs">
                          {u.role}
                        </Badge>
                        <Select
                          value={u.role}
                          onValueChange={(role) => handleRoleChange(u.id, role)}
                          disabled={isRoleSaving}
                        >
                          <SelectTrigger className="h-8 w-32 text-xs" data-testid={`select-role-${u.id}`}>
                            {isRoleSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <SelectValue />}
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="everyone">Everyone</SelectItem>
                            <SelectItem value="manager">Manager</SelectItem>
                            <SelectItem value="user">User</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>

                        {isUser && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-muted-foreground"
                            onClick={() => toggleExpanded(u.id)}
                            data-testid={`button-toggle-tenants-${u.id}`}
                          >
                            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </Button>
                        )}

                        {/* Delete user */}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                              disabled={deleteUserMutation.isPending}
                              data-testid={`button-delete-user-${u.id}`}
                            >
                              <UserX className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete and revoke access?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete <strong>{u.name}</strong> ({u.email}) and immediately invalidate their session. They will be signed out and required to sign in again with Google, at which point they will start with the default <strong>everyone</strong> role.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteUserMutation.mutate(u.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                data-testid={`button-confirm-delete-user-${u.id}`}
                              >
                                Delete &amp; Revoke
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>

                    {/* Tenant access — collapsible, only for "user" role */}
                    {isUser && expanded && (
                      <div className="pl-12 space-y-3 pt-1 border-t border-border/60">
                        <div className="flex items-center justify-between pt-2">
                          <p className="text-xs text-muted-foreground font-medium">Push access</p>
                          <Select
                            value={u.pushPermission}
                            onValueChange={(val) => handlePushPermissionChange(u.id, val)}
                            disabled={savingPushPermissions.has(u.id)}
                          >
                            <SelectTrigger className="h-7 w-40 text-xs" data-testid={`select-push-permission-${u.id}`}>
                              {savingPushPermissions.has(u.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <SelectValue />}
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="both">Both</SelectItem>
                              <SelectItem value="reprice_only">Reprice only</SelectItem>
                              <SelectItem value="add_new_only">Add new only</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <p className="text-xs text-muted-foreground font-medium">Tenant Access</p>
                        {tenants.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No tenants configured yet.</p>
                        ) : (
                          <>
                            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
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
                                      disabled={isTenantSaving}
                                    />
                                    <span className="truncate">{t.name}</span>
                                  </label>
                                );
                              })}
                            </div>

                            <div className="flex justify-end pt-1">
                              <Button
                                size="sm"
                                onClick={() => handleSaveTenants(u.id)}
                                disabled={isTenantSaving || !dirty}
                                data-testid={`button-save-tenants-${u.id}`}
                              >
                                {isTenantSaving ? (
                                  <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Saving…</>
                                ) : (
                                  "Save Changes"
                                )}
                              </Button>
                            </div>
                          </>
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
