import { useState, useEffect, useRef } from "react";
import { useTenants, useServiceTitan } from "@/hooks/use-tenants";
import { useSettings } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, CheckCircle2, XCircle, Upload, Building2, ChevronRight, ChevronDown, ArrowLeft, RefreshCw, Percent, Clock, DollarSign, ArrowUp } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

interface PushProgress {
  stage: 'connected' | 'materials' | 'equipment' | 'services' | 'updating' | 'complete' | 'error' | 'cancelled' | 'queued';
  message: string;
  current: number;
  total: number;
  percent: number;
  startedAt?: number;  // Unix timestamp when push started
  phaseStartedAt?: number;  // Unix timestamp when current phase started
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
  // Only calculate ETA for updating phase with meaningful progress
  if (progress.stage !== 'updating' || !progress.phaseStartedAt || progress.current < 2 || progress.total === 0) {
    return null;
  }
  
  const elapsed = (Date.now() - progress.phaseStartedAt) / 1000;
  const rate = progress.current / elapsed;
  
  if (rate <= 0) return null;
  
  const remaining = progress.total - progress.current;
  const etaSeconds = remaining / rate;
  
  if (etaSeconds < 1) return 'Almost done...';
  if (etaSeconds > 7200) return null; // Don't show if more than 2 hours
  
  return `~${formatETA(etaSeconds)} remaining`;
}

interface Category {
  id: number;
  name: string;
  active: boolean;
  parentId?: number;
}

export default function PushToServiceTitan() {
  const { tenants, isLoading: isTenantsLoading } = useTenants();
  const { settings } = useSettings();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'connected' | 'failed'>('idle');
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<Set<number>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(new Set());
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [pushProgress, setPushProgress] = useState<PushProgress | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Local pricing settings (initialized from global settings)
  const [targetMePercent, setTargetMePercent] = useState<string>("23.00");
  const [salesTaxPercent, setSalesTaxPercent] = useState<string>("6.35");
  const [laborMode, setLaborMode] = useState<"hours" | "percent">("percent");
  const [laborHourlyRate, setLaborHourlyRate] = useState<string>("125.00");
  const [laborHours, setLaborHours] = useState<string>("8");
  const [laborPercent, setLaborPercent] = useState<string>("7.00");
  const [laborBurdenPercent, setLaborBurdenPercent] = useState<string>("20.00");
  const [commissionPercent, setCommissionPercent] = useState<string>("10.00");
  const [commissionBurdenPercent, setCommissionBurdenPercent] = useState<string>("20.00");
  const [financingFeePercent, setFinancingFeePercent] = useState<string>("6.00");
  const [roundUp, setRoundUp] = useState<boolean>(false);

  // Initialize local settings from global settings when they load
  useEffect(() => {
    if (settings) {
      setTargetMePercent(settings.targetMePercent);
      setSalesTaxPercent(settings.salesTaxPercent);
      setLaborMode(settings.laborMode as "hours" | "percent");
      setLaborHourlyRate(settings.laborHourlyRate);
      setLaborPercent(settings.laborPercent);
      setLaborBurdenPercent(settings.laborBurdenPercent);
      setCommissionPercent(settings.commissionPercent);
      setCommissionBurdenPercent(settings.commissionBurdenPercent);
      setFinancingFeePercent(settings.financingFeePercent);
    }
  }, [settings]);

  const { testConnection, isTesting } = useServiceTitan(selectedTenantId);

  const handleTenantSelect = async (value: string) => {
    const id = Number(value);
    setSelectedTenantId(id);
    setConnectionStatus('testing');
    setCategories([]);
    setSelectedCategories(new Set());

    try {
      const response = await testConnection(id);
      const result = await response.json();
      if (result.success) {
        setConnectionStatus('connected');
        await loadCategories(id);
      } else {
        setConnectionStatus('failed');
      }
    } catch (err) {
      setConnectionStatus('failed');
      toast({
        title: "Connection Failed",
        description: "Could not connect to ServiceTitan. Please check your credentials.",
        variant: "destructive",
      });
    }
  };

  const loadCategories = async (tenantId: number) => {
    setIsLoadingCategories(true);
    try {
      const response = await fetch(`/api/servicetitan/${tenantId}/categories`);
      if (response.ok) {
        const data = await response.json();
        setCategories(data);
      }
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to load pricebook categories.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingCategories(false);
    }
  };

  const getChildren = (parentId: number) => categories.filter(c => c.parentId === parentId);
  
  const getAllDescendants = (parentId: number): number[] => {
    const children = getChildren(parentId);
    let descendants: number[] = [];
    for (const child of children) {
      descendants.push(child.id);
      descendants = descendants.concat(getAllDescendants(child.id));
    }
    return descendants;
  };

  const toggleCategory = (categoryId: number) => {
    const category = categories.find(c => c.id === categoryId);
    if (!category) return;
    
    const children = getChildren(categoryId);
    const hasChildren = children.length > 0;
    
    setSelectedCategories(prev => {
      const next = new Set(prev);
      const isCurrentlySelected = next.has(categoryId);
      
      if (isCurrentlySelected) {
        next.delete(categoryId);
        if (hasChildren) {
          const descendants = getAllDescendants(categoryId);
          descendants.forEach(id => next.delete(id));
        }
      } else {
        next.add(categoryId);
        if (hasChildren) {
          const descendants = getAllDescendants(categoryId);
          descendants.filter(id => {
            const cat = categories.find(c => c.id === id);
            return cat?.active;
          }).forEach(id => next.add(id));
        }
      }
      return next;
    });
  };

  const toggleExpanded = (categoryId: number) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedCategories(new Set(categories.filter(c => c.active).map(c => c.id)));
  };

  const deselectAll = () => {
    setSelectedCategories(new Set());
  };

  const handlePush = async () => {
    if (!selectedTenantId || selectedCategories.size === 0) return;
    
    setIsPushing(true);
    setPushProgress({ stage: 'connected', message: 'Starting push...', current: 0, total: 0, percent: 0 });
    
    // Close any existing event source
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    
    // Set up SSE connection for progress updates
    const eventSource = new EventSource(`/api/servicetitan/${selectedTenantId}/push/progress`);
    eventSourceRef.current = eventSource;
    
    eventSource.onmessage = (event) => {
      try {
        const progress = JSON.parse(event.data) as PushProgress;
        setPushProgress(progress);
        
        // Close EventSource when complete, error, or cancelled
        if (progress.stage === 'complete' || progress.stage === 'error' || progress.stage === 'cancelled') {
          eventSource.close();
          eventSourceRef.current = null;
        }
      } catch (err) {
        console.error('Failed to parse progress event:', err);
      }
    };
    
    eventSource.onerror = () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
    
    try {
      const response = await fetch(`/api/servicetitan/${selectedTenantId}/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryIds: Array.from(selectedCategories),
          targetMePercent: parseFloat(targetMePercent),
          salesTaxPercent: parseFloat(salesTaxPercent),
          laborMode,
          laborHourlyRate: parseFloat(laborHourlyRate),
          laborHours: parseFloat(laborHours),
          laborPercent: parseFloat(laborPercent),
          laborBurdenPercent: parseFloat(laborBurdenPercent),
          commissionPercent: parseFloat(commissionPercent),
          commissionBurdenPercent: parseFloat(commissionBurdenPercent),
          financingFeePercent: parseFloat(financingFeePercent),
          roundUp,
        }),
      });
      
      // Handle 202 Accepted (queued)
      if (response.status === 202) {
        const data = await response.json();
        
        toast({
          title: "Push Queued",
          description: `Your push is queued at position ${data.queuePosition}. It will auto-start when a slot opens.`,
        });
        
        setPushProgress({ 
          stage: 'queued', 
          message: `Queued at position ${data.queuePosition}. ${data.activeCount}/${data.maxConcurrent} pushes active. Will auto-start.`, 
          current: 0, 
          total: 0, 
          percent: 0 
        });
        
        setIsPushing(false);
        eventSource.close();
        eventSourceRef.current = null;
        return;
      }
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Push failed");
      }
      
      const results = await response.json();
      
      // Backend now handles history updates, just show toast
      if (results.cancelled) {
        toast({
          title: "Push Cancelled",
          description: `Cancelled after updating ${results.updated} services. You can revert from History.`,
        });
      } else if (results.errors && results.errors.length > 0) {
        toast({
          title: "Push Completed with Warnings",
          description: `Updated ${results.updated} of ${results.processed} services. ${results.errors.length} errors occurred.`,
        });
      } else {
        toast({
          title: "Push Complete",
          description: `Successfully updated ${results.updated} of ${results.processed} services (${results.skipped || 0} skipped).`,
        });
      }
    } catch (err: any) {
      toast({
        title: "Push Failed",
        description: err.message || "An error occurred while pushing to ServiceTitan.",
        variant: "destructive",
      });
    } finally {
      setIsPushing(false);
      // Clear progress after a delay so user can see final status
      setTimeout(() => {
        setPushProgress(null);
      }, 5000);
    }
  };
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const parentCategories = categories.filter(c => !c.parentId);

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
          <h1 className="text-3xl font-display font-bold text-foreground">Push to ServiceTitan</h1>
          <p className="text-muted-foreground mt-1">Apply M&E calculations to your pricebook.</p>
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

      {tenants.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Building2 className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No tenants configured</h3>
            <p className="text-muted-foreground text-center mb-4">
              You need to add a ServiceTitan tenant before you can push pricebook updates.
            </p>
            <Button onClick={() => setLocation("/tenants")} className="gap-2">
              Manage Tenants
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Section 1: Select Tenant */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">1. Select Tenant</CardTitle>
              <CardDescription>Choose which ServiceTitan account to update</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <Select 
                  value={selectedTenantId?.toString() || ""} 
                  onValueChange={handleTenantSelect}
                >
                  <SelectTrigger className="w-[300px]" data-testid="select-tenant">
                    <SelectValue placeholder="Select a tenant..." />
                  </SelectTrigger>
                  <SelectContent>
                    {tenants.map(tenant => (
                      <SelectItem key={tenant.id} value={tenant.id.toString()}>
                        {tenant.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                {connectionStatus === 'testing' && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Testing connection...</span>
                  </div>
                )}
                {connectionStatus === 'connected' && (
                  <div className="flex items-center gap-2 text-emerald-600">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-sm font-medium">Connected</span>
                  </div>
                )}
                {connectionStatus === 'failed' && (
                  <div className="flex items-center gap-2 text-destructive">
                    <XCircle className="w-4 h-4" />
                    <span className="text-sm font-medium">Connection failed</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {connectionStatus === 'connected' && (
            <>
              {/* Section 2: Select Categories */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">2. Select Categories</CardTitle>
                      <CardDescription>
                        Choose which pricebook categories to apply the M&E calculation
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={selectAll}>
                        Select All
                      </Button>
                      <Button variant="outline" size="sm" onClick={deselectAll}>
                        Deselect All
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => selectedTenantId && loadCategories(selectedTenantId)}
                        disabled={isLoadingCategories}
                      >
                        <RefreshCw className={`w-4 h-4 ${isLoadingCategories ? 'animate-spin' : ''}`} />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {isLoadingCategories ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    </div>
                  ) : categories.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">
                      No categories found in this pricebook.
                    </p>
                  ) : (
                    <div className="space-y-1 max-h-[400px] overflow-y-auto pr-2">
                      {parentCategories.map(parent => {
                        const children = getChildren(parent.id);
                        const hasChildren = children.length > 0;
                        const isExpanded = expandedCategories.has(parent.id);
                        
                        const renderCategory = (category: Category, depth: number = 0) => {
                          const catChildren = getChildren(category.id);
                          const hasCatChildren = catChildren.length > 0;
                          const isCatExpanded = expandedCategories.has(category.id);
                          
                          return (
                            <div key={category.id}>
                              <div 
                                className={`flex items-center gap-2 p-3 border-b transition-colors ${
                                  selectedCategories.has(category.id) 
                                    ? 'bg-primary/5' 
                                    : 'hover:bg-muted/50'
                                }`}
                                style={{ paddingLeft: `${(depth * 24) + 12}px` }}
                              >
                                {hasCatChildren ? (
                                  <button
                                    type="button"
                                    onClick={() => toggleExpanded(category.id)}
                                    className="p-1 rounded hover:bg-muted"
                                    data-testid={`button-expand-${category.id}`}
                                  >
                                    {isCatExpanded ? (
                                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                    ) : (
                                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                    )}
                                  </button>
                                ) : (
                                  <div className="w-6" />
                                )}
                                <Checkbox
                                  id={`category-${category.id}`}
                                  checked={selectedCategories.has(category.id)}
                                  onCheckedChange={() => toggleCategory(category.id)}
                                  disabled={!category.active}
                                  data-testid={`checkbox-category-${category.id}`}
                                />
                                <label 
                                  htmlFor={`category-${category.id}`}
                                  className={`flex-1 cursor-pointer ${depth === 0 ? 'font-medium' : 'text-sm'} ${!category.active ? 'text-muted-foreground' : ''}`}
                                >
                                  {category.name}
                                </label>
                                {hasCatChildren && (
                                  <span className="text-xs text-muted-foreground mr-2">
                                    {catChildren.length} subcategories
                                  </span>
                                )}
                                {!category.active && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                              </div>
                              
                              {hasCatChildren && isCatExpanded && (
                                <div>
                                  {catChildren.map(child => renderCategory(child, depth + 1))}
                                </div>
                              )}
                            </div>
                          );
                        };
                        
                        return renderCategory(parent, 0);
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Section 3: Pricing Settings */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">3. Pricing Settings</CardTitle>
                  <CardDescription>
                    Configure the pricing calculations for this push (defaults from your global settings)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Target M&E and Sales Tax Row */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="targetMePercent" className="flex items-center gap-2">
                        <Percent className="w-4 h-4 text-primary" />
                        Target M&E %
                      </Label>
                      <select
                        id="targetMePercent"
                        value={targetMePercent}
                        onChange={(e) => setTargetMePercent(e.target.value)}
                        data-testid="select-target-me-percent"
                        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-2.5 py-1.5 text-sm font-medium ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {Array.from({ length: 21 }, (_, i) => (15 + i * 0.5).toFixed(1)).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}%
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-muted-foreground">
                        Materials & Equipment as a percentage of total price
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="salesTaxPercent" className="flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-primary" />
                        Sales Tax %
                      </Label>
                      <div className="relative">
                        <Input
                          id="salesTaxPercent"
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={salesTaxPercent}
                          onChange={(e) => setSalesTaxPercent(e.target.value)}
                          className="pr-8"
                          data-testid="input-sales-tax-percent"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Tax rate applied to the total price
                      </p>
                    </div>
                  </div>

                  {/* Labor Settings */}
                  <div className="space-y-4 pt-4 border-t">
                    <Label className="flex items-center gap-2 text-base font-medium">
                      <Clock className="w-4 h-4 text-primary" />
                      Labor Calculation
                    </Label>
                    
                    <RadioGroup
                      value={laborMode}
                      onValueChange={(value) => setLaborMode(value as "hours" | "percent")}
                      className="flex gap-6"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="percent" id="labor-percent" data-testid="radio-labor-percent" />
                        <Label htmlFor="labor-percent" className="cursor-pointer">Percentage of Price</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="hours" id="labor-hours" data-testid="radio-labor-hours" />
                        <Label htmlFor="labor-hours" className="cursor-pointer">Hourly Rate</Label>
                      </div>
                    </RadioGroup>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-muted/50 rounded-lg">
                      {laborMode === "percent" ? (
                        <div className="space-y-2">
                          <Label htmlFor="laborPercent">Labor %</Label>
                          <div className="relative">
                            <Input
                              id="laborPercent"
                              type="number"
                              step="0.01"
                              min="0"
                              max="100"
                              value={laborPercent}
                              onChange={(e) => setLaborPercent(e.target.value)}
                              className="pr-8"
                              data-testid="input-labor-percent"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="space-y-2">
                            <Label htmlFor="laborHours"># of Hours</Label>
                            <Input
                              id="laborHours"
                              type="number"
                              step="0.5"
                              min="0"
                              value={laborHours}
                              onChange={(e) => setLaborHours(e.target.value)}
                              data-testid="input-labor-hours"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="laborHourlyRate">Hourly Rate</Label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                              <Input
                                id="laborHourlyRate"
                                type="number"
                                step="0.01"
                                min="0"
                                value={laborHourlyRate}
                                onChange={(e) => setLaborHourlyRate(e.target.value)}
                                className="pl-8"
                                data-testid="input-labor-hourly-rate"
                              />
                            </div>
                          </div>
                        </>
                      )}

                      <div className="space-y-2">
                        <Label htmlFor="laborBurdenPercent">Labor Burden %</Label>
                        <div className="relative">
                          <Input
                            id="laborBurdenPercent"
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            value={laborBurdenPercent}
                            onChange={(e) => setLaborBurdenPercent(e.target.value)}
                            className="pr-8"
                            data-testid="input-labor-burden-percent"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Commission Settings */}
                  <div className="space-y-4 pt-4 border-t">
                    <Label className="flex items-center gap-2 text-base font-medium">
                      <Percent className="w-4 h-4 text-primary" />
                      Commission
                    </Label>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
                      <div className="space-y-2">
                        <Label htmlFor="commissionPercent">Commission %</Label>
                        <div className="relative">
                          <Input
                            id="commissionPercent"
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            value={commissionPercent}
                            onChange={(e) => setCommissionPercent(e.target.value)}
                            className="pr-8"
                            data-testid="input-commission-percent"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Sales commission as percentage of price
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="commissionBurdenPercent">Commission Burden %</Label>
                        <div className="relative">
                          <Input
                            id="commissionBurdenPercent"
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            value={commissionBurdenPercent}
                            onChange={(e) => setCommissionBurdenPercent(e.target.value)}
                            className="pr-8"
                            data-testid="input-commission-burden-percent"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Additional burden on commission
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Financing Settings */}
                  <div className="space-y-4 pt-4 border-t">
                    <Label className="flex items-center gap-2 text-base font-medium">
                      <DollarSign className="w-4 h-4 text-primary" />
                      Financing
                    </Label>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
                      <div className="space-y-2">
                        <Label htmlFor="financingFeePercent">Financing Fee %</Label>
                        <div className="relative">
                          <Input
                            id="financingFeePercent"
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            value={financingFeePercent}
                            onChange={(e) => setFinancingFeePercent(e.target.value)}
                            className="pr-8"
                            data-testid="input-financing-fee-percent"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Financing fee as percentage of price
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Summary Badge */}
                  <div className="flex flex-wrap gap-2 pt-4 border-t">
                    <Badge variant="secondary" className="text-xs">
                      Target M&E: {targetMePercent}%
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      Sales Tax: {salesTaxPercent}%
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      Labor: {laborMode === "percent" ? `${laborPercent}%` : `${laborHours}hrs @ $${laborHourlyRate}/hr`}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      Labor Burden: {laborBurdenPercent}%
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      Commission: {commissionPercent}%
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      Comm. Burden: {commissionBurdenPercent}%
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      Financing: {financingFeePercent}%
                    </Badge>
                    {roundUp && (
                      <Badge variant="secondary" className="text-xs">
                        Round Up: On
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Section 4: Push Updates */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">4. Push Updates</CardTitle>
                  <CardDescription>
                    Apply the M&E percentage calculation to all items in the selected categories
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <ArrowUp className="w-4 h-4 text-primary" />
                      <div>
                        <Label htmlFor="roundUp" className="cursor-pointer font-medium">Round Up Prices</Label>
                        <p className="text-xs text-muted-foreground">
                          Round all prices up to the nearest whole dollar
                        </p>
                      </div>
                    </div>
                    <Switch
                      id="roundUp"
                      checked={roundUp}
                      onCheckedChange={setRoundUp}
                      data-testid="switch-round-up"
                    />
                  </div>
                  
                  {/* Progress Bar - shown during push */}
                  {(isPushing || pushProgress) && pushProgress?.stage !== 'connected' && (
                    <div className="space-y-3 p-4 bg-muted/30 rounded-lg border" data-testid="push-progress">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {pushProgress?.stage === 'complete' ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          ) : pushProgress?.stage === 'error' ? (
                            <XCircle className="w-4 h-4 text-destructive" />
                          ) : (
                            <Loader2 className="w-4 h-4 animate-spin text-primary" />
                          )}
                          <span className="text-sm font-medium">
                            {pushProgress?.stage === 'materials' && 'Loading Materials'}
                            {pushProgress?.stage === 'equipment' && 'Loading Equipment'}
                            {pushProgress?.stage === 'services' && 'Counting Services'}
                            {pushProgress?.stage === 'updating' && 'Updating Services'}
                            {pushProgress?.stage === 'complete' && 'Push Complete'}
                            {pushProgress?.stage === 'error' && 'Push Failed'}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {pushProgress?.stage === 'updating' && pushProgress.total > 0
                            ? `${pushProgress.current} / ${pushProgress.total}`
                            : pushProgress?.percent !== undefined 
                              ? `${Math.round(pushProgress.percent)}%`
                              : ''
                          }
                        </span>
                      </div>
                      <Progress 
                        value={pushProgress?.percent ?? 0} 
                        className="h-2"
                        data-testid="progress-bar"
                      />
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">{pushProgress?.message}</p>
                        {pushProgress && calculateETA(pushProgress) && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1" data-testid="text-eta">
                            <Clock size={12} />
                            {calculateETA(pushProgress)}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {selectedCategories.size} categories selected
                      </p>
                    </div>
                    <Button 
                      onClick={handlePush}
                      disabled={!selectedTenantId || selectedCategories.size === 0 || isPushing}
                      className="gap-2"
                      data-testid="button-push-to-servicetitan"
                    >
                      {isPushing ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                      Push to ServiceTitan
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}
