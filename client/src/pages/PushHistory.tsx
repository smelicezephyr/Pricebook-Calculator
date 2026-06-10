import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTenants } from "@/hooks/use-tenants";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Clock, CheckCircle2, XCircle, AlertCircle, Trash2, ArrowLeft, History as HistoryIcon, RefreshCw, RotateCcw, RotateCw, StopCircle, Ban, Download, ListOrdered } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import type { PushHistory } from "@shared/schema";

interface PushProgress {
  stage: string;
  message: string;
  current: number;
  total: number;
  percent: number;
  startedAt?: number;
  phaseStartedAt?: number;
}

function formatETA(seconds: number): string {
  if (seconds < 60) {
    return `${Math.ceil(seconds)}s`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.ceil(seconds % 60);
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  } else {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.ceil((seconds % 3600) / 60);
    return `${hrs}h ${mins}m`;
  }
}

function calculateETA(progress: PushProgress): string | null {
  if (progress.stage !== 'updating' || !progress.phaseStartedAt || progress.current < 2 || progress.total === 0) {
    return null;
  }
  
  const elapsed = (Date.now() - progress.phaseStartedAt) / 1000;
  const rate = progress.current / elapsed;
  
  if (rate <= 0) return null;
  
  const remaining = progress.total - progress.current;
  const etaSeconds = remaining / rate;
  
  if (etaSeconds < 1) return 'Almost done...';
  if (etaSeconds > 7200) return null;
  
  return `~${formatETA(etaSeconds)} remaining`;
}

interface QueuePosition {
  position: number;
  queueLength: number;
}

export default function PushHistoryPage() {
  const { isAdmin } = useAuth();
  const { tenants, isLoading: isTenantsLoading } = useTenants();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [selectedTenantId, setSelectedTenantId] = useState<string>("all");
  const [liveProgress, setLiveProgress] = useState<Map<number, PushProgress>>(new Map());
  const [queuePositions, setQueuePositions] = useState<Map<number, QueuePosition>>(new Map());
  const [expandedErrors, setExpandedErrors] = useState<Set<number>>(new Set());
  const [cancelConfirmItem, setCancelConfirmItem] = useState<PushHistory | null>(null);
  const [cancelInProgressItem, setCancelInProgressItem] = useState<PushHistory | null>(null);
  const eventSourcesRef = useRef<Map<number, EventSource>>(new Map());

  const historyUrl = selectedTenantId === "all" 
    ? '/api/push-history' 
    : `/api/push-history?tenantId=${selectedTenantId}`;
    
  const { data: history = [], isLoading: isHistoryLoading, refetch } = useQuery<PushHistory[]>({
    queryKey: [historyUrl],
  });

  // ID of the most recent revertible push PER TENANT — only admins can revert
  const revertibleIds = useMemo(() => {
    const sorted = [...history]
      .filter(h =>
        (h.status === 'completed' || h.status === 'cancelled') &&
        h.originalValues
      )
      .sort((a, b) =>
        new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
      );
    const byTenant = new Map<number, PushHistory>();
    for (const h of sorted) {
      if (!byTenant.has(h.tenantId)) byTenant.set(h.tenantId, h);
    }
    return new Set([...byTenant.values()].map(h => h.id));
  }, [history]);

  function downloadChanges(item: PushHistory, tenantName: string) {
    type ChangeRow = { serviceId: number; serviceName?: string; originalPrice: number; originalCost: number; newPrice?: number };
    const rows: ChangeRow[] = JSON.parse(item.originalValues || '[]');
    const hasNewPrice = rows.some(r => r.newPrice !== undefined);
    const headers = ['Service ID', 'Service Name', 'Price Before', ...(hasNewPrice ? ['Price After'] : [])];
    const csvRows = [
      headers.join(','),
      ...rows.map(r => [
        r.serviceId,
        `"${(r.serviceName ?? '').replace(/"/g, '""')}"`,
        r.originalPrice.toFixed(2),
        ...(hasNewPrice ? [(r.newPrice ?? '').toString()] : []),
      ].join(','))
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `push-changes-${tenantName.replace(/[^a-z0-9]/gi, '-')}-${item.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Connect to SSE for in-progress pushes
  // Note: Only one push per tenant can be active at a time (enforced by backend),
  // so keying by tenantId is correct for this use case.
  useEffect(() => {
    const inProgressItems = history.filter(item => item.status === 'in_progress');
    const currentSources = eventSourcesRef.current;
    
    // Close connections for items no longer in progress
    currentSources.forEach((source, tenantId) => {
      if (!inProgressItems.some(item => item.tenantId === tenantId)) {
        source.close();
        currentSources.delete(tenantId);
        setLiveProgress(prev => {
          const next = new Map(prev);
          next.delete(tenantId);
          return next;
        });
      }
    });
    
    // Open connections for new in-progress items
    for (const item of inProgressItems) {
      if (!currentSources.has(item.tenantId)) {
        const tenantId = item.tenantId;
        const eventSource = new EventSource(`/api/servicetitan/${tenantId}/push/progress`);
        
        eventSource.onmessage = (event) => {
          try {
            const progress = JSON.parse(event.data) as PushProgress;
            setLiveProgress(prev => {
              const next = new Map(prev);
              next.set(tenantId, progress);
              return next;
            });
            
            // Clean up and refresh when push completes
            if (progress.stage === 'complete' || progress.stage === 'error' || progress.stage === 'cancelled') {
              eventSource.close();
              currentSources.delete(tenantId);
              setLiveProgress(prev => {
                const next = new Map(prev);
                next.delete(tenantId);
                return next;
              });
              refetch();
            }
          } catch (e) {
            console.error('Failed to parse progress:', e);
          }
        };
        
        // Don't close on error — the browser's built-in SSE auto-reconnect
        // will re-open the connection after the retry delay set by the server.
        // Closing here would permanently kill the EventSource.
        eventSource.onerror = () => {
          // Connection dropped (e.g. proxy timeout). The browser will
          // automatically reconnect in ~3 seconds using the server's retry hint.
          // We intentionally leave liveProgress intact so the last known
          // progress stays on screen while reconnecting.
        };
        
        currentSources.set(tenantId, eventSource);
      }
    }
    
    return () => {
      currentSources.forEach(source => source.close());
      currentSources.clear();
    };
  }, [history, refetch]);

  // Poll queue positions for pending items every 3 seconds
  useEffect(() => {
    const pendingItems = history.filter(item => item.status === 'pending');

    if (pendingItems.length === 0) {
      setQueuePositions(new Map());
      return;
    }

    let cancelled = false;

    const fetchPositions = async () => {
      const results = await Promise.all(
        pendingItems.map(async (item) => {
          try {
            const res = await fetch(`/api/push-history/${item.id}/queue-position`);
            if (!res.ok) return null;
            const data = await res.json() as QueuePosition;
            return { id: item.id, data };
          } catch {
            return null;
          }
        })
      );

      if (cancelled) return;

      setQueuePositions(prev => {
        const next = new Map(prev);
        let changed = false;
        for (const result of results) {
          if (!result) continue;
          const existing = prev.get(result.id);
          if (!existing || existing.position !== result.data.position || existing.queueLength !== result.data.queueLength) {
            changed = true;
          }
          next.set(result.id, result.data);
        }
        // Remove positions for items that are no longer pending
        for (const id of prev.keys()) {
          if (!pendingItems.some(i => i.id === id)) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      // If any position is -1 the push left the queue (started or removed) — refresh history
      const anyLeft = results.some(r => r && r.data.position === -1);
      if (anyLeft && !cancelled) {
        refetch();
      }
    };

    fetchPositions();
    const interval = setInterval(fetchPositions, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [history, refetch]);

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest('DELETE', `/api/push-history/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/push-history');
        }
      });
      toast({ title: "Deleted", description: "Push history entry removed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete entry.", variant: "destructive" });
    },
  });

  const cancelQueuedMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest('POST', `/api/push-history/${id}/cancel-queued`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/push-history');
        }
      });
      toast({ title: "Cancelled", description: "The queued push has been removed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to cancel the queued push.", variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (tenantId: number) => {
      await apiRequest('POST', `/api/servicetitan/${tenantId}/push/cancel`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/push-history');
        }
      });
      toast({ title: "Cancellation Requested", description: "The push will stop at the next checkpoint." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to cancel push.", variant: "destructive" });
    },
  });

  const revertMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest('POST', `/api/push-history/${id}/revert`);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/push-history');
        }
      });
      toast({ 
        title: "Reverted", 
        description: `Restored ${data.reverted} of ${data.total} services to their original values.` 
      });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to revert push.", 
        variant: "destructive" 
      });
    },
  });

  const retryMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest('POST', `/api/push-history/${id}/retry`);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/push-history');
        }
      });
      toast({
        title: "Push Retried",
        description: data.queued
          ? "Push queued — it will start automatically when a slot opens."
          : "Push started with the same settings.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to retry push.",
        variant: "destructive",
      });
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary" className="gap-1"><Clock className="w-3 h-3" /> Pending</Badge>;
      case 'in_progress':
        return <Badge variant="default" className="gap-1"><Loader2 className="w-3 h-3 animate-spin" /> In Progress</Badge>;
      case 'completed':
        return <Badge variant="default" className="gap-1 bg-emerald-600"><CheckCircle2 className="w-3 h-3" /> Completed</Badge>;
      case 'failed':
        return <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" /> Failed</Badge>;
      case 'cancelled':
        return <Badge variant="secondary" className="gap-1"><Ban className="w-3 h-3" /> Cancelled</Badge>;
      case 'reverted':
        return <Badge variant="outline" className="gap-1"><RotateCcw className="w-3 h-3" /> Reverted</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getTenantName = (tenantId: number) => {
    const tenant = tenants.find(t => t.id === tenantId);
    return tenant?.name || `Tenant ${tenantId}`;
  };

  const formatDate = (date: string | Date | null) => {
    if (!date) return '-';
    return format(new Date(date), 'MMM d, yyyy h:mm a');
  };

  const formatDuration = (startDate: string | Date | null, endDate: string | Date | null) => {
    if (!startDate || !endDate) return null;
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();
    const durationMs = end - start;
    
    if (durationMs < 0) return null;
    
    const seconds = Math.floor(durationMs / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    } else if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    } else {
      const hrs = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
    }
  };

  if (isTenantsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-500 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Push History</h1>
          <p className="text-muted-foreground mt-1">View past ServiceTitan push operations and queue status.</p>
        </div>
        <Button 
          variant="ghost" 
          onClick={() => setLocation("/")}
          className="md:self-start gap-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} />
          Back to Calculator
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <HistoryIcon className="w-5 h-5" />
                Push Operations
              </CardTitle>
              <CardDescription>
                History of all ServiceTitan pricebook push operations
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Select value={selectedTenantId} onValueChange={setSelectedTenantId}>
                <SelectTrigger className="w-full sm:w-[200px]" data-testid="select-filter-tenant">
                  <SelectValue placeholder="Filter by tenant" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tenants</SelectItem>
                  {tenants.map(tenant => (
                    <SelectItem key={tenant.id} value={tenant.id.toString()}>
                      {tenant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={() => refetch()} data-testid="button-refresh">
                <RefreshCw className={`w-4 h-4 ${isHistoryLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isHistoryLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <HistoryIcon className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No push history yet</h3>
              <p className="text-muted-foreground mb-4">
                Push operations will appear here after you push to ServiceTitan.
              </p>
              <Button onClick={() => setLocation("/push")} className="gap-2">
                Go to Push Page
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((item) => {
                const categoryIds = JSON.parse(item.categoryIds || "[]");
                const errorMessages = item.errorMessages ? JSON.parse(item.errorMessages) : [];
                
                return (
                  <div
                    key={item.id}
                    className="p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                    data-testid={`push-history-item-${item.id}`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {getStatusBadge(item.status)}
                          <span className="font-medium truncate">{getTenantName(item.tenantId)}</span>
                          <span className="text-sm text-muted-foreground">
                            {categoryIds.length} categories
                          </span>
                        </div>
                        
                        <div className="text-sm text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                          {(item as any).pushedByName && (
                            <span className="font-medium text-foreground/70">↑ {(item as any).pushedByName}</span>
                          )}
                          <span>Started: {formatDate(item.startedAt || item.createdAt)}</span>
                          {item.completedAt && (
                            <span>Completed: {formatDate(item.completedAt)}</span>
                          )}
                          {item.completedAt && formatDuration(item.startedAt || item.createdAt, item.completedAt) && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              Duration: {formatDuration(item.startedAt || item.createdAt, item.completedAt)}
                            </span>
                          )}
                        </div>

                        {/* Queue position for pending items */}
                        {item.status === 'pending' && (() => {
                          const pos = queuePositions.get(item.id);
                          return (
                            <div
                              className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg border text-sm"
                              data-testid={`queue-position-${item.id}`}
                            >
                              <ListOrdered className="w-4 h-4 text-muted-foreground shrink-0" />
                              {pos && pos.position > 0 ? (
                                <span>
                                  Waiting in queue{' '}
                                  <span className="font-semibold">
                                    (position {pos.position}{pos.queueLength > 1 ? ` of ${pos.queueLength}` : ''})
                                  </span>
                                </span>
                              ) : pos && pos.position === -1 ? (
                                <span className="text-muted-foreground">Starting soon…</span>
                              ) : (
                                <span className="text-muted-foreground">Waiting in queue…</span>
                              )}
                            </div>
                          );
                        })()}

                        {/* Live progress for in-progress items */}
                        {item.status === 'in_progress' && liveProgress.has(item.tenantId) && (() => {
                          const progress = liveProgress.get(item.tenantId)!;
                          const eta = calculateETA(progress);
                          return (
                            <div className="space-y-2 p-3 bg-muted/30 rounded-lg border" data-testid={`live-progress-${item.id}`}>
                              <div className="flex items-center justify-between text-sm">
                                <span className="font-medium">
                                  {progress.stage === 'materials' && 'Loading Materials...'}
                                  {progress.stage === 'equipment' && 'Loading Equipment...'}
                                  {progress.stage === 'services' && 'Counting Services...'}
                                  {progress.stage === 'updating' && `Updating: ${progress.current} / ${progress.total}`}
                                </span>
                                {eta && (
                                  <span className="text-muted-foreground flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {eta}
                                  </span>
                                )}
                              </div>
                              <Progress value={progress.percent} className="h-2" />
                              <p className="text-xs text-muted-foreground">{progress.message}</p>
                            </div>
                          );
                        })()}

                        <div className="flex flex-wrap gap-2 text-xs">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className="cursor-default">M&E: {item.targetMePercent}%</Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Target Materials &amp; Equipment margin — the gross profit percentage applied to equipment costs when calculating the sell price.</p>
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className="cursor-default">Tax: {item.salesTaxPercent}%</Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Sales tax rate added on top of equipment costs during price calculation.</p>
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className="cursor-default">
                                Labor: {item.laborMode === 'percent' 
                                  ? `${item.laborPercent}%` 
                                  : `$${item.laborHourlyRate}/hr × ${item.laborHours || 8}h`}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>
                                {item.laborMode === 'percent'
                                  ? `Labor cost calculated as ${item.laborPercent}% of the total job price.`
                                  : `Labor cost calculated at $${item.laborHourlyRate}/hr for ${item.laborHours || 8} hours.`}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                          {item.roundUp && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="cursor-default">Round Up</Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Final prices were rounded up to the nearest whole dollar.</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {item.skipZeroEquipment && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="cursor-default">Skip Zero-Equipment</Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Items with no equipment cost ($0) were skipped and not pushed to the pricebook.</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>

                        {(item.status === 'completed' || item.status === 'failed' || item.status === 'cancelled' || item.status === 'reverted') && (
                          <div className="flex flex-wrap gap-4 text-sm">
                            <span className="text-muted-foreground">
                              Processed: <span className="font-medium text-foreground">{item.processedCount}</span>
                            </span>
                            <span className="text-muted-foreground">
                              Updated: <span className="font-medium text-emerald-600">{item.updatedCount}</span>
                            </span>
                            {(item.skippedCount ?? 0) > 0 && (
                              <span className="text-muted-foreground">
                                Skipped: <span className="font-medium">{item.skippedCount}</span>
                              </span>
                            )}
                            {(item.errorCount ?? 0) > 0 && (
                              <span className="text-destructive flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" />
                                Errors: {item.errorCount}
                              </span>
                            )}
                          </div>
                        )}

                        {errorMessages.length > 0 && (() => {
                          const isExpanded = expandedErrors.has(item.id);
                          const shown = isExpanded ? errorMessages : errorMessages.slice(0, 3);
                          const hidden = errorMessages.length - 3;
                          return (
                            <div className="mt-2 p-2 bg-destructive/10 rounded text-xs text-destructive space-y-0.5">
                              {shown.map((err: string, idx: number) => (
                                <p key={idx} className="break-all">{err}</p>
                              ))}
                              {errorMessages.length > 3 && (
                                <button
                                  className="mt-1 text-muted-foreground hover:text-foreground underline underline-offset-2 cursor-pointer"
                                  onClick={() => setExpandedErrors(prev => {
                                    const next = new Set(prev);
                                    isExpanded ? next.delete(item.id) : next.add(item.id);
                                    return next;
                                  })}
                                  data-testid={`button-toggle-errors-${item.id}`}
                                >
                                  {isExpanded ? 'Show less' : `Show ${hidden} more`}
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </div>

                      <div className="flex sm:flex-col flex-row flex-wrap gap-2 shrink-0">
                        {item.status === 'pending' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCancelConfirmItem(item)}
                            disabled={cancelQueuedMutation.isPending}
                            className="gap-1 text-orange-600 border-orange-300"
                            data-testid={`button-cancel-queued-${item.id}`}
                          >
                            {cancelQueuedMutation.isPending && cancelConfirmItem?.id === item.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <StopCircle className="w-4 h-4" />
                            )}
                            Cancel
                          </Button>
                        )}
                        {item.status === 'in_progress' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCancelInProgressItem(item)}
                            disabled={cancelMutation.isPending}
                            className="gap-1 text-orange-600 border-orange-300"
                            data-testid={`button-cancel-${item.id}`}
                          >
                            {cancelMutation.isPending && cancelInProgressItem?.id === item.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <StopCircle className="w-4 h-4" />
                            )}
                            Cancel
                          </Button>
                        )}
                        {(item.status === 'completed' ||
                          item.status === 'failed' ||
                          item.status === 'cancelled' ||
                          item.status === 'reverted') && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => retryMutation.mutate(item.id)}
                            disabled={retryMutation.isPending}
                            className="gap-1 text-blue-600 border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                            data-testid={`button-retry-${item.id}`}
                          >
                            {retryMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <RotateCw className="w-4 h-4" />
                            )}
                            Retry
                          </Button>
                        )}
                        {isAdmin && revertibleIds.has(item.id) && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => revertMutation.mutate(item.id)}
                            disabled={revertMutation.isPending}
                            className="gap-1"
                            data-testid={`button-revert-${item.id}`}
                          >
                            {revertMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <RotateCcw className="w-4 h-4" />
                            )}
                            Revert
                          </Button>
                        )}
                        {isAdmin && item.originalValues && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => downloadChanges(item, getTenantName(item.tenantId))}
                            className="gap-1"
                            data-testid={`button-download-changes-${item.id}`}
                          >
                            <Download className="w-4 h-4" />
                            Changes
                          </Button>
                        )}
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteMutation.mutate(item.id)}
                            disabled={deleteMutation.isPending}
                            className="text-muted-foreground"
                            data-testid={`button-delete-${item.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={cancelInProgressItem !== null}
        onOpenChange={(open) => { if (!open) setCancelInProgressItem(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel in-progress push?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelInProgressItem && (() => {
                const tenantName = getTenantName(cancelInProgressItem.tenantId);
                return `The push for ${tenantName} will stop at the next checkpoint. Any updates already applied to ServiceTitan will not be rolled back — the pricebook may be left in a partially-updated state.`;
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-inprogress-dismiss">Keep Running</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-cancel-inprogress-proceed"
              onClick={() => {
                if (cancelInProgressItem) {
                  cancelMutation.mutate(cancelInProgressItem.tenantId);
                  setCancelInProgressItem(null);
                }
              }}
            >
              Yes, Cancel Push
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={cancelConfirmItem !== null}
        onOpenChange={(open) => { if (!open) setCancelConfirmItem(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel queued push?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelConfirmItem && (() => {
                const categoryIds = JSON.parse(cancelConfirmItem.categoryIds || "[]");
                const tenantName = getTenantName(cancelConfirmItem.tenantId);
                return `This will remove the queued push for ${tenantName} (${categoryIds.length} ${categoryIds.length === 1 ? 'category' : 'categories'}) from the queue. This action cannot be undone.`;
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-confirm-dismiss">Keep in Queue</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-cancel-confirm-proceed"
              onClick={() => {
                if (cancelConfirmItem) {
                  cancelQueuedMutation.mutate(cancelConfirmItem.id);
                  setCancelConfirmItem(null);
                }
              }}
            >
              Yes, Cancel Push
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
