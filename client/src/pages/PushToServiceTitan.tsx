import { useState, useEffect, useRef, useMemo } from "react";
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
import { Loader2, CheckCircle2, XCircle, Upload, Building2, ChevronRight, ChevronDown, ArrowLeft, RefreshCw, Percent, Clock, DollarSign, ArrowUp, Plus, ImagePlus, Search, Check, ChevronsUpDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

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

interface GLAccount {
  id: number;
  name: string;
  number?: string;
  type?: string;
  active: boolean;
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

  // Push New Task State
  const [activeTab, setActiveTab] = useState<string>("update-category");
  const [glAccounts, setGlAccounts] = useState<GLAccount[]>([]);
  const [isLoadingGlAccounts, setIsLoadingGlAccounts] = useState(false);
  const [newTaskCode, setNewTaskCode] = useState("");
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskWarranty, setNewTaskWarranty] = useState("");
  const [newTaskTaxable, setNewTaskTaxable] = useState(true);
  const [newTaskAllowDiscounts, setNewTaskAllowDiscounts] = useState(false);
  const [newTaskAllowMembership, setNewTaskAllowMembership] = useState(false);
  const [newTaskHours, setNewTaskHours] = useState("0");
  const [newTaskGlAccountId, setNewTaskGlAccountId] = useState<number | null>(null);
  const [newTaskCategoryId, setNewTaskCategoryId] = useState<number | null>(null);
  const [newTaskMaterialsCost, setNewTaskMaterialsCost] = useState("0");
  const [newTaskEquipmentCost, setNewTaskEquipmentCost] = useState("0");
  const [newTaskImage, setNewTaskImage] = useState<File | null>(null);
  const [newTaskImagePreview, setNewTaskImagePreview] = useState<string | null>(null);
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [glAccountOpen, setGlAccountOpen] = useState(false);
  const [categorySelectOpen, setCategorySelectOpen] = useState(false);

  // Calculate price and metrics for new task
  const newTaskCalculations = useMemo(() => {
    const matVal = parseFloat(newTaskMaterialsCost) || 0;
    const equipVal = parseFloat(newTaskEquipmentCost) || 0;
    const salesTaxRate = parseFloat(salesTaxPercent) / 100;
    const tax = (matVal + equipVal) * salesTaxRate;
    const totalMe = matVal + equipVal + tax;
    const targetMeRate = parseFloat(targetMePercent) / 100;
    const rawPrice = targetMeRate > 0 ? totalMe / targetMeRate : 0;
    const price = roundUp ? Math.ceil(rawPrice) : rawPrice;
    
    // Calculate direct labor
    let directLabor = 0;
    if (laborMode === "hours") {
      const hours = parseFloat(laborHours) || 0;
      const rate = parseFloat(laborHourlyRate) || 0;
      directLabor = hours * rate;
    } else {
      const laborRate = parseFloat(laborPercent) / 100;
      directLabor = price * laborRate;
    }
    
    // Calculate labor with burden
    const laborBurdenRate = parseFloat(laborBurdenPercent) / 100;
    const laborWithBurden = directLabor * (1 + laborBurdenRate);
    
    // Calculate commission with burden
    const commissionRate = parseFloat(commissionPercent) / 100;
    const commission = price * commissionRate;
    const commBurdenRate = parseFloat(commissionBurdenPercent) / 100;
    const commissionWithBurden = commission * (1 + commBurdenRate);
    
    // Calculate financing
    const financingRate = parseFloat(financingFeePercent) / 100;
    const financing = price * financingRate;
    
    // Calculate total COGS
    const totalCogs = totalMe + laborWithBurden + commissionWithBurden + financing;
    
    // Calculate gross margin
    const grossMarginAmount = price - totalCogs;
    const grossMarginPercent = price > 0 ? (grossMarginAmount / price) * 100 : 0;
    
    // Actual M&E percent achieved
    const actualMePercent = price > 0 ? (totalMe / price) * 100 : 0;
    
    return {
      price,
      totalMe,
      tax,
      directLabor,
      laborWithBurden,
      commission,
      commissionWithBurden,
      financing,
      grossMarginAmount,
      grossMarginPercent,
      actualMePercent,
    };
  }, [
    newTaskMaterialsCost, newTaskEquipmentCost, salesTaxPercent, targetMePercent, roundUp,
    laborMode, laborHours, laborHourlyRate, laborPercent, laborBurdenPercent,
    commissionPercent, commissionBurdenPercent, financingFeePercent
  ]);
  
  const newTaskCalculatedPrice = newTaskCalculations.price;

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

  const loadGlAccounts = async (tenantId: number) => {
    setIsLoadingGlAccounts(true);
    try {
      const response = await fetch(`/api/servicetitan/${tenantId}/gl-accounts`);
      if (response.ok) {
        const data = await response.json();
        setGlAccounts(data.filter((a: GLAccount) => a.active));
      } else {
        const error = await response.json();
        console.error("Failed to load GL accounts:", error);
        const isPermissionError = error.message?.includes('403') || error.message?.includes('permission');
        toast({
          title: "GL Accounts Unavailable",
          description: isPermissionError
            ? "The ServiceTitan credentials don't have permission to access GL accounts. You can still create tasks without selecting a GL account."
            : "Could not load GL accounts. You can still create tasks without selecting a GL account.",
        });
      }
    } catch (err) {
      console.error("Failed to load GL accounts:", err);
      toast({
        title: "GL Accounts Unavailable",
        description: "Could not load GL accounts. You can still create tasks without selecting a GL account.",
      });
    } finally {
      setIsLoadingGlAccounts(false);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setNewTaskImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewTaskImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const resetNewTaskForm = () => {
    setNewTaskCode("");
    setNewTaskName("");
    setNewTaskDescription("");
    setNewTaskWarranty("");
    setNewTaskTaxable(true);
    setNewTaskAllowDiscounts(false);
    setNewTaskAllowMembership(false);
    setNewTaskHours("0");
    setNewTaskGlAccountId(null);
    setNewTaskCategoryId(null);
    setNewTaskMaterialsCost("0");
    setNewTaskEquipmentCost("0");
    setNewTaskImage(null);
    setNewTaskImagePreview(null);
  };

  const handleCreateTask = async () => {
    if (!selectedTenantId) return;
    
    const code = newTaskCode.trim();
    const name = newTaskName.trim();
    
    if (!code) {
      toast({ title: "Error", description: "Code is required", variant: "destructive" });
      return;
    }
    if (code.length > 31) {
      toast({ title: "Error", description: "Code must be 31 characters or less", variant: "destructive" });
      return;
    }
    if (!name) {
      toast({ title: "Error", description: "Name is required", variant: "destructive" });
      return;
    }
    if (!newTaskCategoryId) {
      toast({ title: "Error", description: "Please select a category", variant: "destructive" });
      return;
    }
    
    const hoursVal = parseFloat(newTaskHours);
    if (isNaN(hoursVal) || hoursVal < 0) {
      toast({ title: "Error", description: "Hours must be a non-negative number", variant: "destructive" });
      return;
    }

    setIsCreatingTask(true);
    try {
      const serviceData: any = {
        code,
        name,
        description: newTaskDescription.trim() || undefined,
        warrantyDescription: newTaskWarranty.trim() || undefined,
        isTaxable: newTaskTaxable,
        isActive: true,
        price: newTaskCalculatedPrice,
        hours: hoursVal,
        categoryIds: [newTaskCategoryId],
        allowDiscountCodes: newTaskAllowDiscounts,
        allowMembershipDiscounts: newTaskAllowMembership,
      };
      
      if (newTaskGlAccountId) {
        serviceData.generalLedgerAccountId = newTaskGlAccountId;
      }

      const response = await fetch(`/api/servicetitan/${selectedTenantId}/services`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serviceData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create task');
      }

      const createdService = await response.json();

      if (newTaskImage) {
        try {
          const reader = new FileReader();
          const imageData = await new Promise<string>((resolve, reject) => {
            reader.onloadend = () => {
              const base64 = (reader.result as string).split(',')[1];
              resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(newTaskImage);
          });

          await fetch(`/api/servicetitan/${selectedTenantId}/services/${createdService.id}/image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageData,
              filename: newTaskImage.name,
              mimeType: newTaskImage.type,
            }),
          });
        } catch (imgErr) {
          console.error("Failed to upload image:", imgErr);
          toast({
            title: "Task Created",
            description: "Task was created but image upload failed. You can add the image in ServiceTitan.",
          });
        }
      }

      toast({
        title: "Success",
        description: `Task "${newTaskName}" created successfully with price $${newTaskCalculatedPrice.toFixed(2)}`,
      });
      
      resetNewTaskForm();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to create task",
        variant: "destructive",
      });
    } finally {
      setIsCreatingTask(false);
    }
  };

  // Load GL accounts when tenant is connected
  useEffect(() => {
    if (connectionStatus === 'connected' && selectedTenantId) {
      loadGlAccounts(selectedTenantId);
    }
  }, [connectionStatus, selectedTenantId]);

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
        // Try to parse JSON error, but handle non-JSON responses (e.g., HTML error pages)
        let errorMessage = "Push failed";
        try {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const error = await response.json();
            errorMessage = error.message || "Push failed";
          } else {
            errorMessage = `Server error (${response.status}): ${response.statusText}`;
          }
        } catch {
          errorMessage = `Server error (${response.status}): Unable to parse response`;
        }
        throw new Error(errorMessage);
      }
      
      // Also handle non-JSON success responses (shouldn't happen but defensive)
      let results;
      try {
        results = await response.json();
      } catch {
        throw new Error("Invalid response from server");
      }
      
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
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="update-category" data-testid="tab-update-category">
                  Update Pricebook Category
                </TabsTrigger>
                <TabsTrigger value="push-new-task" data-testid="tab-push-new-task">
                  Push New Task
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="update-category" className="space-y-6 mt-6">
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
                    Updates <span className="font-medium">Static Price</span> based on M&E cost calculation. 
                    <span className="text-muted-foreground/70"> Note: Estimated Labor Cost cannot be updated via API - it's calculated by ServiceTitan.</span>
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
              </TabsContent>

              <TabsContent value="push-new-task" className="space-y-6 mt-6">
                {/* Push New Task Section */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Plus className="w-5 h-5" />
                      Create New Service Task
                    </CardTitle>
                    <CardDescription>
                      Create a new service in your ServiceTitan pricebook with calculated pricing
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Calculator Section */}
                    <div className="p-4 bg-muted/30 rounded-lg border space-y-4">
                      <h3 className="font-medium text-sm flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-primary" />
                        Price Calculator
                      </h3>
                      
                      {/* Settings Row */}
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="newTaskMePercent">Target M&E %</Label>
                          <Select value={targetMePercent} onValueChange={setTargetMePercent}>
                            <SelectTrigger id="newTaskMePercent" data-testid="select-new-task-me-percent">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 41 }, (_, i) => {
                                const val = (10 + i * 0.5).toFixed(2);
                                return <SelectItem key={val} value={val}>{val}%</SelectItem>;
                              })}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="newTaskSalesTax">Sales Tax %</Label>
                          <Input
                            id="newTaskSalesTax"
                            type="number"
                            step="0.01"
                            min="0"
                            max="20"
                            value={salesTaxPercent}
                            onChange={(e) => setSalesTaxPercent(e.target.value)}
                            data-testid="input-new-task-sales-tax"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="newTaskLaborMode">Labor Mode</Label>
                          <Select value={laborMode} onValueChange={(v) => setLaborMode(v as "hours" | "percent")}>
                            <SelectTrigger id="newTaskLaborMode" data-testid="select-new-task-labor-mode">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="percent">Percentage of Price</SelectItem>
                              <SelectItem value="hours">Hourly Rate</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {laborMode === "percent" ? (
                          <div className="space-y-2">
                            <Label htmlFor="newTaskLaborPercent">Labor %</Label>
                            <div className="relative">
                              <Input
                                id="newTaskLaborPercent"
                                type="number"
                                step="0.5"
                                min="0"
                                max="100"
                                value={laborPercent}
                                onChange={(e) => setLaborPercent(e.target.value)}
                                className="pr-7"
                                data-testid="input-new-task-labor-percent"
                              />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <Label htmlFor="newTaskLaborHours">Labor Hours</Label>
                            <Input
                              id="newTaskLaborHours"
                              type="number"
                              step="0.5"
                              min="0"
                              value={laborHours}
                              onChange={(e) => setLaborHours(e.target.value)}
                              data-testid="input-new-task-labor-hours"
                            />
                          </div>
                        )}
                      </div>

                      {/* Additional Settings Row */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="newTaskCommission">Commission %</Label>
                          <div className="relative">
                            <Input
                              id="newTaskCommission"
                              type="number"
                              step="0.5"
                              min="0"
                              max="100"
                              value={commissionPercent}
                              onChange={(e) => setCommissionPercent(e.target.value)}
                              className="pr-7"
                              data-testid="input-new-task-commission"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="newTaskFinancing">Financing Fee %</Label>
                          <div className="relative">
                            <Input
                              id="newTaskFinancing"
                              type="number"
                              step="0.5"
                              min="0"
                              max="100"
                              value={financingFeePercent}
                              onChange={(e) => setFinancingFeePercent(e.target.value)}
                              className="pr-7"
                              data-testid="input-new-task-financing"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="newTaskLaborBurden">Labor Burden %</Label>
                          <div className="relative">
                            <Input
                              id="newTaskLaborBurden"
                              type="number"
                              step="0.5"
                              min="0"
                              max="100"
                              value={laborBurdenPercent}
                              onChange={(e) => setLaborBurdenPercent(e.target.value)}
                              className="pr-7"
                              data-testid="input-new-task-labor-burden"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                          </div>
                        </div>
                      </div>

                      {/* Inputs Row */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="newTaskMaterials">Materials Cost</Label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                            <Input
                              id="newTaskMaterials"
                              type="number"
                              step="0.01"
                              min="0"
                              value={newTaskMaterialsCost}
                              onChange={(e) => setNewTaskMaterialsCost(e.target.value)}
                              className="pl-7"
                              data-testid="input-new-task-materials"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="newTaskEquipment">Equipment Cost</Label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                            <Input
                              id="newTaskEquipment"
                              type="number"
                              step="0.01"
                              min="0"
                              value={newTaskEquipmentCost}
                              onChange={(e) => setNewTaskEquipmentCost(e.target.value)}
                              className="pl-7"
                              data-testid="input-new-task-equipment"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Calculated Price</Label>
                          <div className="h-9 px-3 py-2 bg-primary/10 rounded-md border border-primary/20 flex items-center justify-between">
                            <span className="text-lg font-bold text-primary">
                              ${newTaskCalculatedPrice.toFixed(2)}
                            </span>
                            <div className="flex items-center gap-2">
                              <Label htmlFor="roundUpNewTask" className="text-xs cursor-pointer">Round Up</Label>
                              <Switch
                                id="roundUpNewTask"
                                checked={roundUp}
                                onCheckedChange={setRoundUp}
                                data-testid="switch-new-task-round-up"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Metrics Display Row */}
                      <div className="grid grid-cols-3 gap-3 pt-2">
                        {(() => {
                          const minMargin = parseFloat(settings?.grossMarginMinPercent || "50");
                          const currentMargin = newTaskCalculations.grossMarginPercent;
                          let glowStyle = {};
                          let borderClass = "border-border";
                          
                          if (currentMargin >= minMargin) {
                            glowStyle = { boxShadow: '0 0 12px 3px rgba(16, 185, 129, 0.5)' };
                            borderClass = "border-emerald-500";
                          } else if (currentMargin >= minMargin - 2) {
                            glowStyle = { boxShadow: '0 0 12px 3px rgba(245, 158, 11, 0.5)' };
                            borderClass = "border-amber-500";
                          } else {
                            glowStyle = { boxShadow: '0 0 12px 3px rgba(239, 68, 68, 0.5)' };
                            borderClass = "border-red-500";
                          }
                          
                          return (
                            <div 
                              className={`bg-white dark:bg-card rounded-lg p-3 border ${borderClass} shadow-sm transition-all duration-300`}
                              style={glowStyle}
                            >
                              <p className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">Gross Margin</p>
                              <p className="text-lg font-bold text-foreground">{newTaskCalculations.grossMarginPercent.toFixed(2)}%</p>
                              <p className="text-xs text-muted-foreground">${newTaskCalculations.grossMarginAmount.toFixed(2)}</p>
                            </div>
                          );
                        })()}
                        <div className="bg-white dark:bg-card rounded-lg p-3 border border-border shadow-sm">
                          <p className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">M&E Percent</p>
                          <p className="text-lg font-bold text-foreground">{newTaskCalculations.actualMePercent.toFixed(2)}%</p>
                        </div>
                        <div className="bg-white dark:bg-card rounded-lg p-3 border border-border shadow-sm">
                          <p className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">Direct Labor</p>
                          <p className="text-lg font-bold text-foreground">${newTaskCalculations.directLabor.toFixed(2)}</p>
                        </div>
                      </div>
                    </div>

                    {/* Service Details */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="newTaskCode">Code *</Label>
                        <Input
                          id="newTaskCode"
                          value={newTaskCode}
                          onChange={(e) => setNewTaskCode(e.target.value.slice(0, 31))}
                          placeholder="e.g., 10015"
                          maxLength={31}
                          data-testid="input-new-task-code"
                        />
                        <p className="text-xs text-muted-foreground">{newTaskCode.length}/31 characters</p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="newTaskName">Name *</Label>
                        <Input
                          id="newTaskName"
                          value={newTaskName}
                          onChange={(e) => setNewTaskName(e.target.value)}
                          placeholder="e.g., After Hours Service Fee"
                          data-testid="input-new-task-name"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="newTaskDescription">Item Description</Label>
                      <Textarea
                        id="newTaskDescription"
                        value={newTaskDescription}
                        onChange={(e) => setNewTaskDescription(e.target.value)}
                        placeholder="Enter a description of the service..."
                        rows={3}
                        data-testid="input-new-task-description"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="newTaskWarranty">Warranty Description</Label>
                      <Textarea
                        id="newTaskWarranty"
                        value={newTaskWarranty}
                        onChange={(e) => setNewTaskWarranty(e.target.value)}
                        placeholder="Enter warranty information..."
                        rows={2}
                        data-testid="input-new-task-warranty"
                      />
                    </div>

                    {/* Checkboxes Row */}
                    <div className="flex flex-wrap gap-6">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="newTaskTaxable"
                          checked={newTaskTaxable}
                          onCheckedChange={(checked) => setNewTaskTaxable(checked === true)}
                          data-testid="checkbox-new-task-taxable"
                        />
                        <Label htmlFor="newTaskTaxable" className="cursor-pointer">Taxable</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="newTaskAllowDiscounts"
                          checked={newTaskAllowDiscounts}
                          onCheckedChange={(checked) => setNewTaskAllowDiscounts(checked === true)}
                          data-testid="checkbox-new-task-discounts"
                        />
                        <Label htmlFor="newTaskAllowDiscounts" className="cursor-pointer">Allow Discount Codes</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="newTaskAllowMembership"
                          checked={newTaskAllowMembership}
                          onCheckedChange={(checked) => setNewTaskAllowMembership(checked === true)}
                          data-testid="checkbox-new-task-membership"
                        />
                        <Label htmlFor="newTaskAllowMembership" className="cursor-pointer">Allow Membership Discounts</Label>
                      </div>
                    </div>

                    {/* Hours and GL Account */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="newTaskHours">Hours</Label>
                        <Input
                          id="newTaskHours"
                          type="number"
                          step="0.01"
                          min="0"
                          value={laborMode === "hours" ? laborHours : newTaskHours}
                          onChange={(e) => {
                            if (laborMode === "hours") {
                              setLaborHours(e.target.value);
                            }
                            setNewTaskHours(e.target.value);
                          }}
                          data-testid="input-new-task-hours"
                        />
                        {laborMode === "hours" && (
                          <p className="text-xs text-muted-foreground">
                            Synced with Labor Hours above
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>General Ledger Account</Label>
                        <Popover open={glAccountOpen} onOpenChange={setGlAccountOpen}>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              role="combobox"
                              aria-expanded={glAccountOpen}
                              className="w-full justify-between"
                              data-testid="button-select-gl-account"
                            >
                              {newTaskGlAccountId
                                ? glAccounts.find(a => a.id === newTaskGlAccountId)?.name || "Select..."
                                : "Select GL Account..."}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[300px] p-0">
                            <Command>
                              <CommandInput placeholder="Search GL accounts..." />
                              <CommandList>
                                <CommandEmpty>
                                  {isLoadingGlAccounts ? "Loading..." : "No GL account found."}
                                </CommandEmpty>
                                <CommandGroup>
                                  {glAccounts.map((account) => (
                                    <CommandItem
                                      key={account.id}
                                      value={account.name}
                                      onSelect={() => {
                                        setNewTaskGlAccountId(account.id === newTaskGlAccountId ? null : account.id);
                                        setGlAccountOpen(false);
                                      }}
                                    >
                                      <Check
                                        className={cn(
                                          "mr-2 h-4 w-4",
                                          newTaskGlAccountId === account.id ? "opacity-100" : "opacity-0"
                                        )}
                                      />
                                      {account.name}
                                      {account.number && <span className="ml-2 text-muted-foreground">({account.number})</span>}
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>

                    {/* Category Selection */}
                    <div className="space-y-2">
                      <Label>Category *</Label>
                      <Popover open={categorySelectOpen} onOpenChange={setCategorySelectOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={categorySelectOpen}
                            className="w-full justify-between"
                            data-testid="button-select-category"
                          >
                            {newTaskCategoryId
                              ? categories.find(c => c.id === newTaskCategoryId)?.name || "Select..."
                              : "Select category..."}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[400px] p-0">
                          <Command>
                            <CommandInput placeholder="Search categories..." />
                            <CommandList>
                              <CommandEmpty>
                                {isLoadingCategories ? "Loading..." : "No category found."}
                              </CommandEmpty>
                              <CommandGroup>
                                {(() => {
                                  const activeCategories = categories.filter(c => c.active);
                                  const parentCategories = activeCategories.filter(c => !c.parentId);
                                  const getChildren = (parentId: number) => 
                                    activeCategories.filter(c => c.parentId === parentId);
                                  
                                  const renderCategory = (category: Category, depth: number = 0): React.ReactNode[] => {
                                    const children = getChildren(category.id);
                                    const items: React.ReactNode[] = [
                                      <CommandItem
                                        key={category.id}
                                        value={category.name}
                                        onSelect={() => {
                                          setNewTaskCategoryId(category.id === newTaskCategoryId ? null : category.id);
                                          setCategorySelectOpen(false);
                                        }}
                                        className={depth > 0 ? "pl-6" : ""}
                                      >
                                        <Check
                                          className={cn(
                                            "mr-2 h-4 w-4",
                                            newTaskCategoryId === category.id ? "opacity-100" : "opacity-0"
                                          )}
                                        />
                                        <span className={depth > 0 ? "text-muted-foreground" : "font-medium"}>
                                          {depth > 0 ? "└ " : ""}{category.name}
                                        </span>
                                      </CommandItem>
                                    ];
                                    children.forEach(child => {
                                      items.push(...renderCategory(child, depth + 1));
                                    });
                                    return items;
                                  };
                                  
                                  return parentCategories.flatMap(cat => renderCategory(cat, 0));
                                })()}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>

                    {/* Image Upload */}
                    <div className="space-y-2">
                      <Label>Image (optional)</Label>
                      <div className="flex items-start gap-4">
                        <div className="flex-1">
                          <label
                            htmlFor="newTaskImage"
                            className="flex items-center justify-center gap-2 h-24 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                          >
                            <ImagePlus className="w-6 h-6 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">
                              {newTaskImage ? newTaskImage.name : "Click to upload image"}
                            </span>
                          </label>
                          <input
                            id="newTaskImage"
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleImageSelect}
                            data-testid="input-new-task-image"
                          />
                        </div>
                        {newTaskImagePreview && (
                          <div className="relative">
                            <img
                              src={newTaskImagePreview}
                              alt="Preview"
                              className="w-24 h-24 object-cover rounded-lg border"
                            />
                            <Button
                              variant="destructive"
                              size="icon"
                              className="absolute -top-2 -right-2 w-6 h-6"
                              onClick={() => {
                                setNewTaskImage(null);
                                setNewTaskImagePreview(null);
                              }}
                            >
                              <XCircle className="w-4 h-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Submit Button */}
                    <div className="flex justify-end pt-4 border-t">
                      <Button
                        onClick={handleCreateTask}
                        disabled={isCreatingTask || !newTaskCode || !newTaskName || !newTaskCategoryId}
                        className="gap-2"
                        data-testid="button-create-task"
                      >
                        {isCreatingTask ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Plus className="w-4 h-4" />
                        )}
                        Create Task
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}
        </div>
      )}
    </div>
  );
}
