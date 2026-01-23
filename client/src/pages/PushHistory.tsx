import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTenants } from "@/hooks/use-tenants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Clock, CheckCircle2, XCircle, AlertCircle, Trash2, ArrowLeft, History as HistoryIcon, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import type { PushHistory } from "@shared/schema";

export default function PushHistoryPage() {
  const { tenants, isLoading: isTenantsLoading } = useTenants();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [selectedTenantId, setSelectedTenantId] = useState<string>("all");

  const historyUrl = selectedTenantId === "all" 
    ? '/api/push-history' 
    : `/api/push-history?tenantId=${selectedTenantId}`;
    
  const { data: history = [], isLoading: isHistoryLoading, refetch } = useQuery<PushHistory[]>({
    queryKey: [historyUrl],
  });

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
          <div className="flex items-center justify-between">
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
                <SelectTrigger className="w-[200px]" data-testid="select-filter-tenant">
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
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-3">
                          {getStatusBadge(item.status)}
                          <span className="font-medium">{getTenantName(item.tenantId)}</span>
                          <span className="text-sm text-muted-foreground">
                            {categoryIds.length} categories
                          </span>
                        </div>
                        
                        <div className="text-sm text-muted-foreground">
                          <span>Created: {formatDate(item.createdAt)}</span>
                          {item.completedAt && (
                            <span className="ml-4">Completed: {formatDate(item.completedAt)}</span>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2 text-xs">
                          <Badge variant="outline">M&E: {item.targetMePercent}%</Badge>
                          <Badge variant="outline">Tax: {item.salesTaxPercent}%</Badge>
                          <Badge variant="outline">
                            Labor: {item.laborMode === 'percent' 
                              ? `${item.laborPercent}%` 
                              : `$${item.laborHourlyRate}/hr × ${item.laborHours || 8}h`}
                          </Badge>
                          {item.roundUp && <Badge variant="outline">Round Up</Badge>}
                        </div>

                        {(item.status === 'completed' || item.status === 'failed') && (
                          <div className="flex gap-4 text-sm">
                            <span className="text-muted-foreground">
                              Processed: <span className="font-medium text-foreground">{item.processedCount}</span>
                            </span>
                            <span className="text-muted-foreground">
                              Updated: <span className="font-medium text-emerald-600">{item.updatedCount}</span>
                            </span>
                            {(item.errorCount ?? 0) > 0 && (
                              <span className="text-destructive flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" />
                                Errors: {item.errorCount}
                              </span>
                            )}
                          </div>
                        )}

                        {errorMessages.length > 0 && (
                          <div className="mt-2 p-2 bg-destructive/10 rounded text-xs text-destructive max-h-20 overflow-y-auto">
                            {errorMessages.slice(0, 3).map((err: string, idx: number) => (
                              <p key={idx}>{err}</p>
                            ))}
                            {errorMessages.length > 3 && (
                              <p className="text-muted-foreground">...and {errorMessages.length - 3} more</p>
                            )}
                          </div>
                        )}
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteMutation.mutate(item.id)}
                        disabled={deleteMutation.isPending}
                        className="text-muted-foreground hover:text-destructive"
                        data-testid={`button-delete-${item.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
