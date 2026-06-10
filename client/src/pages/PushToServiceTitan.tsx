import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTenants, useServiceTitan } from "@/hooks/use-tenants";
import { useSettings } from "@/hooks/use-settings";
import { useAuth } from "@/contexts/AuthContext";
import type { Location } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, CheckCircle2, XCircle, Upload, Building2, ChevronRight, ChevronDown, ArrowLeft, RefreshCw, Percent, Clock, DollarSign, ArrowUp, Plus, ImagePlus, Search, Check, ChevronsUpDown, Wrench, MapPin, Edit, Trash2, ListOrdered, Info } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { queryClient, apiRequest } from "@/lib/queryClient";



interface Category {
  id: number;
  name: string;
  active: boolean;
  parentId?: number;
  sortOrder?: number;
  displayOrder?: number;
}

export default function PushToServiceTitan() {
  const { tenants, isLoading: isTenantsLoading } = useTenants();
  const { settings } = useSettings();
  const { user, isAdmin } = useAuth();
  const pushPermission = isAdmin ? "both" : (user?.pushPermission ?? "both");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: locationsList = [] } = useQuery<Location[]>({ queryKey: ['/api/locations'] });

  const [taxRegionsOpen, setTaxRegionsOpen] = useState(false);
  const [taxRegionDialogOpen, setTaxRegionDialogOpen] = useState(false);
  const [editingRegion, setEditingRegion] = useState<Location | null>(null);
  const [regionName, setRegionName] = useState("");
  const [regionTax, setRegionTax] = useState("");

  const createRegionMutation = useMutation({
    mutationFn: async (data: { name: string; salesTaxPercent: string }) => {
      const res = await apiRequest("POST", "/api/locations", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      setTaxRegionDialogOpen(false);
      toast({ title: "Tax region added" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateRegionMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { name: string; salesTaxPercent: string } }) => {
      const res = await apiRequest("PUT", `/api/locations/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      setTaxRegionDialogOpen(false);
      toast({ title: "Tax region updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteRegionMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/locations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Tax region deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openCreateRegion = () => {
    setEditingRegion(null);
    setRegionName("");
    setRegionTax("");
    setTaxRegionDialogOpen(true);
  };

  const openEditRegion = (loc: Location) => {
    setEditingRegion(loc);
    setRegionName(loc.name);
    setRegionTax(loc.salesTaxPercent);
    setTaxRegionDialogOpen(true);
  };

  const handleRegionSubmit = () => {
    if (!regionName.trim()) {
      toast({ title: "Error", description: "Region name is required", variant: "destructive" });
      return;
    }
    const taxVal = parseFloat(regionTax);
    if (isNaN(taxVal) || taxVal < 0) {
      toast({ title: "Error", description: "Sales tax must be a valid number", variant: "destructive" });
      return;
    }
    const data = { name: regionName.trim(), salesTaxPercent: taxVal.toFixed(2) };
    if (editingRegion) {
      updateRegionMutation.mutate({ id: editingRegion.id, data });
    } else {
      createRegionMutation.mutate(data);
    }
  };

  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'connected' | 'failed'>('idle');
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<Set<number>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(new Set());
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [isPushing, setIsPushing] = useState(false);

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
  const [skipZeroEquipment, setSkipZeroEquipment] = useState<boolean>(() => {
    try { return localStorage.getItem("push_skipZeroEquipment") === "true"; } catch { return false; }
  });

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
      if (!selectedTenantId) {
        setRepairSalesTaxPercent(settings.salesTaxPercent);
      }
    }
  }, [settings]);

  const { testConnection, isTesting } = useServiceTitan(selectedTenantId);

  // Push New Task State
  const [activeTab, setActiveTab] = useState<string>(
    pushPermission === "add_new_only" ? "push-new-task" : "update-category"
  );

  // Reconcile activeTab when pushPermission resolves (auth loads after initial render)
  useEffect(() => {
    if (pushPermission === "add_new_only" && activeTab === "update-category") {
      setActiveTab("push-new-task");
    } else if (pushPermission === "reprice_only" && (activeTab === "push-new-task" || activeTab === "push-new-repair")) {
      setActiveTab("update-category");
    }
  }, [pushPermission]);
  const [newTaskCode, setNewTaskCode] = useState("");
  const [newTaskCodeError, setNewTaskCodeError] = useState<string | null>(null);
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskWarranty, setNewTaskWarranty] = useState("");
  const [newTaskTaxable, setNewTaskTaxable] = useState(true);
  const [newTaskAllowDiscounts, setNewTaskAllowDiscounts] = useState(true);
  const [newTaskAllowMembership, setNewTaskAllowMembership] = useState(true);
  const [newTaskHours, setNewTaskHours] = useState("0");
  const [newTaskGlAccount, setNewTaskGlAccount] = useState<string>("Revenue");
  const [newTaskCategoryId, setNewTaskCategoryId] = useState<number | null>(null);
  const [newTaskMaterialsCost, setNewTaskMaterialsCost] = useState("0");
  const [newTaskEquipmentCost, setNewTaskEquipmentCost] = useState("0");
  const [newTaskImage, setNewTaskImage] = useState<File | null>(null);
  const [newTaskImagePreview, setNewTaskImagePreview] = useState<string | null>(null);
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [categorySelectOpen, setCategorySelectOpen] = useState(false);

  // Push New Repair Task State
  const [repairCode, setRepairCode] = useState("");
  const [repairCodeError, setRepairCodeError] = useState<string | null>(null);
  const [repairName, setRepairName] = useState("");
  const [repairDescription, setRepairDescription] = useState("");
  const [repairWarranty, setRepairWarranty] = useState("");
  const [repairTaxable, setRepairTaxable] = useState(true);
  const [repairAllowDiscounts, setRepairAllowDiscounts] = useState(true);
  const [repairAllowMembership, setRepairAllowMembership] = useState(true);
  const [repairLaborHours, setRepairLaborHours] = useState("");
  const [repairLaborRate, setRepairLaborRate] = useState("175");
  const [repairGlAccount, setRepairGlAccount] = useState<string>("Revenue");
  const [repairCategoryId, setRepairCategoryId] = useState<number | null>(null);
  const [repairMaterialsCost, setRepairMaterialsCost] = useState("");
  const [repairMaterialMarkup, setRepairMaterialMarkup] = useState("200");
  const [repairSalesTaxPercent, setRepairSalesTaxPercent] = useState(settings?.salesTaxPercent || "6.35");
  const [repairBurdenPercent, setRepairBurdenPercent] = useState("20.00");
  const [repairCommissionPercent, setRepairCommissionPercent] = useState("10.00");
  const [repairFinancingFeePercent, setRepairFinancingFeePercent] = useState("4");
  const [repairHighestTechRate, setRepairHighestTechRate] = useState("");
  const [repairLaborMode, setRepairLaborMode] = useState<"dollars" | "percent">("dollars");

  const [repairImage, setRepairImage] = useState<File | null>(null);
  const [repairImagePreview, setRepairImagePreview] = useState<string | null>(null);
  const [isCreatingRepair, setIsCreatingRepair] = useState(false);
  const [repairCategorySelectOpen, setRepairCategorySelectOpen] = useState(false);

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
    
    // Calculate burden rate (applies to both labor and commission)
    const burdenRate = parseFloat(laborBurdenPercent) / 100;
    
    // Calculate labor with burden
    const laborWithBurden = directLabor * (1 + burdenRate);
    
    // Calculate commission with burden
    const commissionRate = parseFloat(commissionPercent) / 100;
    const commission = price * commissionRate;
    const commissionWithBurden = commission * (1 + burdenRate);
    
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

  // Calculate price for repair task (matching RepairCalculator logic)
  const repairCalculations = useMemo(() => {
    const partsTotal = parseFloat(repairMaterialsCost) || 0;
    const markupRate = (parseFloat(repairMaterialMarkup) || 200) / 100;
    const laborRateVal = parseFloat(repairLaborRate) || 0;
    const laborHoursVal = parseFloat(repairLaborHours) || 0;
    const burdenRate = (parseFloat(repairBurdenPercent) || 0) / 100;
    const taxRate = (parseFloat(repairSalesTaxPercent) || 0) / 100;
    const commissionRate = (parseFloat(repairCommissionPercent) || 0) / 100;
    const financingRate = (parseFloat(repairFinancingFeePercent) || 0) / 100;

    const salesTax = partsTotal * taxRate;
    const subtotal1 = partsTotal + salesTax;

    const markupAmount = subtotal1 * markupRate;
    const subtotal2 = subtotal1 + markupAmount;

    let directLaborCost: number;
    let laborBurden: number;
    let burdenedLaborCost: number;
    let subtotal3: number;
    let directCommission: number;
    let commissionBurden: number;
    let burdenedCommission: number;
    let subtotal4: number;
    let financingFee: number;
    let totalBeforeRounding: number;

    if (repairLaborMode === "percent") {
      directLaborCost = 0;
      laborBurden = 0;
      burdenedLaborCost = 0;
      subtotal3 = subtotal2;

      const denominator = 1 - commissionRate * (1 + burdenRate) - financingRate;
      const totalPriceCalc = denominator > 0 ? subtotal3 / denominator : subtotal3;

      directCommission = totalPriceCalc * commissionRate;
      commissionBurden = directCommission * burdenRate;
      burdenedCommission = directCommission + commissionBurden;
      financingFee = totalPriceCalc * financingRate;
      subtotal4 = subtotal3 + burdenedCommission;
      totalBeforeRounding = subtotal4 + financingFee;
    } else {
      directLaborCost = laborRateVal * laborHoursVal;
      laborBurden = directLaborCost * burdenRate;
      burdenedLaborCost = directLaborCost + laborBurden;
      subtotal3 = subtotal2 + burdenedLaborCost;

      const denominator = 1 - commissionRate * (1 + burdenRate) - financingRate;
      const totalPriceCalc = denominator > 0 ? subtotal3 / denominator : subtotal3;

      directCommission = totalPriceCalc * commissionRate;
      commissionBurden = directCommission * burdenRate;
      burdenedCommission = directCommission + commissionBurden;
      financingFee = totalPriceCalc * financingRate;
      subtotal4 = subtotal3 + burdenedCommission;
      totalBeforeRounding = subtotal4 + financingFee;
    }

    const totalPrice = roundUp ? Math.ceil(totalBeforeRounding) : totalBeforeRounding;

    const highestTechRateVal = parseFloat(repairHighestTechRate) || 0;
    const techLaborCost = repairLaborMode === "percent"
      ? 0
      : highestTechRateVal * laborHoursVal;
    const burdenedTechLabor = techLaborCost * (1 + burdenRate);
    const cogs = partsTotal + burdenedTechLabor + burdenedCommission;
    const grossMargin = totalPrice - cogs;
    const grossMarginPercent = totalPrice > 0 ? (grossMargin / totalPrice) * 100 : 0;

    return {
      price: totalPrice,
      partsTotal,
      salesTax,
      subtotal1,
      markupAmount,
      subtotal2,
      directLaborCost,
      laborBurden,
      burdenedLaborCost,
      subtotal3,
      directCommission,
      commissionBurden,
      burdenedCommission,
      subtotal4,
      financingFee,
      cogs,
      totalBurden: laborBurden + commissionBurden,
      grossMargin,
      grossMarginPercent,
      laborHours: laborHoursVal,
    };
  }, [repairMaterialsCost, repairMaterialMarkup, repairLaborRate, repairLaborHours, repairBurdenPercent, repairSalesTaxPercent, repairCommissionPercent, repairFinancingFeePercent, repairHighestTechRate, roundUp, repairLaborMode]);

  const repairCalculatedPrice = repairCalculations.price;

  const handleTenantSelect = async (value: string) => {
    const id = Number(value);
    setSelectedTenantId(id);
    setConnectionStatus('testing');
    setCategories([]);
    setSelectedCategories(new Set());
    setPushSubmitted(false);
    setNewTaskCategoryId(null);
    setNewTaskGlAccount("Revenue");
    setRepairCategoryId(null);
    setRepairGlAccount("Revenue");

    const selectedTenant = tenants.find(t => t.id === id);
    const fallbackTax = settings?.salesTaxPercent || "6.35";
    if (selectedTenant?.locationId) {
      const loc = locationsList.find(l => l.id === selectedTenant.locationId);
      const taxRate = loc ? loc.salesTaxPercent.toString() : fallbackTax;
      setSalesTaxPercent(taxRate);
      setRepairSalesTaxPercent(taxRate);
    } else {
      setSalesTaxPercent(fallbackTax);
      setRepairSalesTaxPercent(fallbackTax);
    }

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
    setNewTaskAllowDiscounts(true);
    setNewTaskAllowMembership(true);
    setNewTaskHours("0");
    setNewTaskGlAccount("Revenue");
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
    setNewTaskCodeError(null); // Clear previous error
    try {
      const serviceData: any = {
        code,
        displayName: name,
        description: newTaskDescription.trim() || undefined,
        warranty: newTaskWarranty.trim() ? { duration: 0, description: newTaskWarranty.trim() } : undefined,
        taxable: newTaskTaxable,
        active: true,
        price: newTaskCalculatedPrice,
        hours: hoursVal,
        categories: [newTaskCategoryId],
        allowDiscountCodes: newTaskAllowDiscounts,
        allowMembershipDiscounts: newTaskAllowMembership,
      };
      
      // Add account name (required field for service creation)
      // ServiceTitan uses account names like "Sales", not numeric IDs
      serviceData.account = newTaskGlAccount || "Sales";

      const response = await fetch(`/api/servicetitan/${selectedTenantId}/services`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serviceData),
      });

      if (!response.ok) {
        const error = await response.json();
        const errorMessage = error.message || 'Failed to create task';
        
        // Check for duplicate code error
        if (errorMessage.toLowerCase().includes('code') && 
            (errorMessage.toLowerCase().includes('repeat') || 
             errorMessage.toLowerCase().includes('duplicate') ||
             errorMessage.toLowerCase().includes('already exists') ||
             errorMessage.toLowerCase().includes('unique'))) {
          setNewTaskCodeError("This code already exists. Please use a unique code.");
          throw new Error("Code already exists - please use a unique code");
        }
        
        throw new Error(errorMessage);
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

      fetch("/api/push-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: selectedTenantId,
          status: "completed",
          pushType: "new_system",
          categoryIds: "[]",
          targetMePercent,
          salesTaxPercent,
          laborMode,
          laborHourlyRate,
          laborHours: newTaskHours,
          laborPercent,
          laborBurdenPercent,
          commissionPercent,
          commissionBurdenPercent,
          financingFeePercent,
          roundUp,
          updatedCount: 1,
          processedCount: 1,
        }),
      }).catch(() => {});

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

  // Repair Task Handlers
  const handleRepairImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setRepairImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setRepairImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const resetRepairForm = () => {
    setRepairCode("");
    setRepairName("");
    setRepairDescription("");
    setRepairWarranty("");
    setRepairTaxable(true);
    setRepairAllowDiscounts(true);
    setRepairAllowMembership(true);
    setRepairLaborHours("1");
    setRepairLaborRate("175");
    setRepairGlAccount("Revenue");
    setRepairCategoryId(null);
    setRepairMaterialsCost("0");
    setRepairCommissionPercent("10.00");
    setRepairFinancingFeePercent("4");
    setRepairImage(null);
    setRepairImagePreview(null);
    setRepairLaborMode("dollars");
    const fallbackTax = settings?.salesTaxPercent || "6.35";
    const selectedTenant = tenants.find(t => t.id === selectedTenantId);
    if (selectedTenant?.locationId) {
      const loc = locationsList.find(l => l.id === selectedTenant.locationId);
      setRepairSalesTaxPercent(loc ? loc.salesTaxPercent.toString() : fallbackTax);
    } else {
      setRepairSalesTaxPercent(fallbackTax);
    }
  };

  const handleCreateRepair = async () => {
    if (!selectedTenantId) return;
    
    const code = repairCode.trim();
    const name = repairName.trim();
    
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
    if (!repairCategoryId) {
      toast({ title: "Error", description: "Please select a category", variant: "destructive" });
      return;
    }
    
    const hoursVal = parseFloat(repairLaborHours);
    if (isNaN(hoursVal) || hoursVal < 0) {
      toast({ title: "Error", description: "Hours must be a non-negative number", variant: "destructive" });
      return;
    }

    setIsCreatingRepair(true);
    setRepairCodeError(null); // Clear previous error
    try {
      const serviceData: any = {
        code,
        displayName: name,
        description: repairDescription.trim() || undefined,
        warranty: repairWarranty.trim() ? { duration: 0, description: repairWarranty.trim() } : undefined,
        taxable: repairTaxable,
        active: true,
        price: repairCalculatedPrice,
        hours: hoursVal,
        categories: [repairCategoryId],
        allowDiscountCodes: repairAllowDiscounts,
        allowMembershipDiscounts: repairAllowMembership,
      };
      
      // Add account name (required field for service creation)
      // ServiceTitan uses account names like "Sales", not numeric IDs
      serviceData.account = repairGlAccount || "Sales";

      const response = await fetch(`/api/servicetitan/${selectedTenantId}/services`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serviceData),
      });

      if (!response.ok) {
        const error = await response.json();
        const errorMessage = error.message || 'Failed to create repair task';
        
        // Check for duplicate code error
        if (errorMessage.toLowerCase().includes('code') && 
            (errorMessage.toLowerCase().includes('repeat') || 
             errorMessage.toLowerCase().includes('duplicate') ||
             errorMessage.toLowerCase().includes('already exists') ||
             errorMessage.toLowerCase().includes('unique'))) {
          setRepairCodeError("This code already exists. Please use a unique code.");
          throw new Error("Code already exists - please use a unique code");
        }
        
        throw new Error(errorMessage);
      }

      const createdService = await response.json();

      if (repairImage) {
        try {
          const reader = new FileReader();
          const imageData = await new Promise<string>((resolve, reject) => {
            reader.onloadend = () => {
              const base64 = (reader.result as string).split(',')[1];
              resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(repairImage);
          });

          await fetch(`/api/servicetitan/${selectedTenantId}/services/${createdService.id}/image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageData,
              filename: repairImage.name,
              mimeType: repairImage.type,
            }),
          });
        } catch (imgErr) {
          console.error("Failed to upload image:", imgErr);
          toast({
            title: "Repair Task Created",
            description: "Task was created but image upload failed. You can add the image in ServiceTitan.",
          });
        }
      }

      toast({
        title: "Success",
        description: `Repair task "${repairName}" created successfully with price $${repairCalculatedPrice.toFixed(2)}`,
      });

      fetch("/api/push-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: selectedTenantId,
          status: "completed",
          pushType: "new_repair",
          categoryIds: "[]",
          targetMePercent,
          salesTaxPercent: repairSalesTaxPercent,
          laborMode: repairLaborMode,
          laborHourlyRate: repairLaborRate,
          laborHours: repairLaborHours,
          laborPercent,
          laborBurdenPercent: repairBurdenPercent,
          commissionPercent: repairCommissionPercent,
          commissionBurdenPercent,
          financingFeePercent: repairFinancingFeePercent,
          roundUp,
          updatedCount: 1,
          processedCount: 1,
        }),
      }).catch(() => {});

      resetRepairForm();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to create repair task",
        variant: "destructive",
      });
    } finally {
      setIsCreatingRepair(false);
    }
  };

  const sortByOrder = (a: Category, b: Category) =>
    (a.sortOrder ?? a.displayOrder ?? 0) - (b.sortOrder ?? b.displayOrder ?? 0);

  const getChildren = (parentId: number) =>
    categories.filter(c => c.parentId === parentId && c.active).sort(sortByOrder);
  
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

  const [pushSubmitted, setPushSubmitted] = useState(false);
  const [pushStatusMessage, setPushStatusMessage] = useState("");
  const [queuedHistoryId, setQueuedHistoryId] = useState<number | null>(null);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);

  const handlePush = async () => {
    if (!selectedTenantId || selectedCategories.size === 0) return;
    
    setIsPushing(true);
    setPushSubmitted(false);
    setQueuedHistoryId(null);
    setQueuePosition(null);
    
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
          skipZeroEquipment,
        }),
      });
      
      if (!response.ok && response.status !== 202) {
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
      
      const data = await response.json();
      const isQueued = response.status === 202;
      
      setPushSubmitted(true);
      if (isQueued) {
        setQueuedHistoryId(data.historyId);
        setQueuePosition(data.queuePosition);
        setPushStatusMessage("");
      } else {
        setPushStatusMessage("Your push is now processing in the background. Track its progress on the Push History page.");
      }
      toast({
        title: isQueued ? "Push Queued" : "Push Submitted",
        description: isQueued 
          ? `Queued at position ${data.queuePosition}. The indicator below will update automatically.`
          : "Your push is now processing. Go to Push History to track progress.",
      });
    } catch (err: any) {
      toast({
        title: "Push Failed",
        description: err.message || "An error occurred while pushing to ServiceTitan.",
        variant: "destructive",
      });
    } finally {
      setIsPushing(false);
    }
  };

  useEffect(() => {
    if (!queuedHistoryId) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/push-history/${queuedHistoryId}/queue-position`);
        if (!res.ok || cancelled) return;
        const data = await res.json() as { position: number; queueLength: number };
        if (cancelled) return;
        if (data.position === -1) {
          setQueuePosition(-1);
          setQueuedHistoryId(null);
          setPushStatusMessage("Your push is now processing in the background. Track its progress on the Push History page.");
        } else {
          setQueuePosition(data.position);
        }
      } catch {
        // ignore transient errors
      }
    };

    poll();
    const interval = setInterval(poll, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [queuedHistoryId]);

  const parentCategories = categories.filter(c => !c.parentId && c.active).sort(sortByOrder);

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

          <Card>
            <CardHeader className="cursor-pointer py-3" onClick={() => setTaxRegionsOpen(!taxRegionsOpen)}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin size={18} className="text-muted-foreground" />
                  <CardTitle className="text-base">Tax Regions</CardTitle>
                  <Badge variant="secondary" className="text-xs">{locationsList.length}</Badge>
                </div>
                {taxRegionsOpen ? <ChevronDown size={16} className="text-muted-foreground" /> : <ChevronRight size={16} className="text-muted-foreground" />}
              </div>
            </CardHeader>
            {taxRegionsOpen && (
              <CardContent className="pt-0 space-y-3">
                {locationsList.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No tax regions configured yet.</p>
                ) : (
                  <div className="space-y-2">
                    {locationsList.map((loc) => (
                      <div key={loc.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                        <div className="flex items-center gap-2">
                          <MapPin size={14} className="text-muted-foreground" />
                          <span className="text-sm font-medium" data-testid={`text-region-name-${loc.id}`}>{loc.name}</span>
                          <Badge variant="outline" className="text-xs" data-testid={`text-region-tax-${loc.id}`}>{loc.salesTaxPercent}%</Badge>
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditRegion(loc)} data-testid={`button-edit-region-${loc.id}`}>
                            <Edit size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => deleteRegionMutation.mutate(loc.id)}
                            disabled={deleteRegionMutation.isPending}
                            data-testid={`button-delete-region-${loc.id}`}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <Button variant="outline" size="sm" onClick={openCreateRegion} className="gap-1" data-testid="button-add-region">
                  <Plus size={14} />
                  Add Region
                </Button>
              </CardContent>
            )}
          </Card>

          <Dialog open={taxRegionDialogOpen} onOpenChange={setTaxRegionDialogOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>{editingRegion ? "Edit Tax Region" : "Add Tax Region"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="regionName">Region Name</Label>
                  <Input
                    id="regionName"
                    value={regionName}
                    onChange={(e) => setRegionName(e.target.value)}
                    placeholder="e.g., Gaithersburg, MD"
                    data-testid="input-region-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="regionTax">Sales Tax %</Label>
                  <Input
                    id="regionTax"
                    type="number"
                    step="0.01"
                    min="0"
                    value={regionTax}
                    onChange={(e) => setRegionTax(e.target.value)}
                    placeholder="e.g., 6.35"
                    data-testid="input-region-tax"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setTaxRegionDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleRegionSubmit}
                  disabled={createRegionMutation.isPending || updateRegionMutation.isPending}
                  data-testid="button-submit-region"
                >
                  {(createRegionMutation.isPending || updateRegionMutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingRegion ? "Update" : "Add"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {connectionStatus === 'connected' && (
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className={`grid w-full h-auto ${pushPermission === "both" ? "grid-cols-3" : "grid-cols-2"}`}>
                {pushPermission !== "add_new_only" && (
                  <TabsTrigger value="update-category" className="text-xs sm:text-sm px-1 sm:px-3 py-2 whitespace-normal" data-testid="tab-update-category">
                    Update Pricebook
                  </TabsTrigger>
                )}
                {pushPermission !== "reprice_only" && (
                  <TabsTrigger value="push-new-task" className="text-xs sm:text-sm px-1 sm:px-3 py-2 whitespace-normal" data-testid="tab-push-new-system-task">
                    New System Task
                  </TabsTrigger>
                )}
                {pushPermission !== "reprice_only" && (
                  <TabsTrigger value="push-new-repair" className="text-xs sm:text-sm px-1 sm:px-3 py-2 whitespace-normal" data-testid="tab-push-new-repair-task">
                    New Repair Task
                  </TabsTrigger>
                )}
              </TabsList>

              {pushPermission !== "both" && (
                <div className="flex items-start gap-2 mt-3 px-3 py-2 rounded-md bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200 text-sm" data-testid="banner-push-permission-notice">
                  <Info className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    Your account is limited to{" "}
                    <strong>{pushPermission === "reprice_only" ? "Reprice only" : "Add new only"}</strong>.
                    {" "}Contact an admin to change this.
                  </span>
                </div>
              )}

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
                                  data-testid={`checkbox-category-${category.id}`}
                                />
                                <label 
                                  htmlFor={`category-${category.id}`}
                                  className={`flex-1 cursor-pointer ${depth === 0 ? 'font-medium' : 'text-sm'}`}
                                >
                                  {category.name}
                                </label>
                                {hasCatChildren && (
                                  <span className="text-xs text-muted-foreground mr-2">
                                    {catChildren.length} subcategories
                                  </span>
                                )}
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
                        {Array.from({ length: 31 }, (_, i) => (15 + i * 0.5).toFixed(1)).map((opt) => (
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
                        <Label htmlFor="financingFeePercent">Finance Fee %</Label>
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
                          Financing fee and/or credit card processing fee
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Skip Zero Equipment Toggle */}
                  <div className="flex items-center justify-between pt-4 border-t">
                    <div className="space-y-0.5">
                      <Label htmlFor="skipZeroEquipment" className="text-sm font-medium cursor-pointer">
                        Skip services with no equipment cost
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        When on, services where equipment = $0 are skipped, even if materials have a value
                      </p>
                    </div>
                    <Switch
                      id="skipZeroEquipment"
                      checked={skipZeroEquipment}
                      onCheckedChange={(val) => {
                        setSkipZeroEquipment(val);
                        try { localStorage.setItem("push_skipZeroEquipment", String(val)); } catch {}
                      }}
                      data-testid="switch-skip-zero-equipment"
                    />
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
                  
                  {pushSubmitted && queuedHistoryId && (
                    <div className="p-4 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800" data-testid="push-queue-indicator">
                      <div className="flex items-center gap-2 mb-2">
                        <ListOrdered className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        <span className="text-sm font-medium text-amber-800 dark:text-amber-200">Waiting in Queue</span>
                        <Loader2 className="w-3 h-3 animate-spin text-amber-500 ml-auto" />
                      </div>
                      <p className="text-sm text-amber-700 dark:text-amber-300 mb-3" data-testid="queue-position-text">
                        {queuePosition && queuePosition > 0
                          ? `Your push is at position ${queuePosition} in the queue. It will start automatically.`
                          : "Your push is in the queue and will start automatically."}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setLocation("/push-history")}
                        data-testid="button-go-to-push-history-queue"
                      >
                        Go to Push History
                      </Button>
                    </div>
                  )}

                  {pushSubmitted && !queuedHistoryId && pushStatusMessage && (
                    <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-800" data-testid="push-submitted-banner">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span className="text-sm font-medium text-emerald-800 dark:text-emerald-200">Push Submitted</span>
                      </div>
                      <p className="text-sm text-emerald-700 dark:text-emerald-300 mb-3">
                        {pushStatusMessage}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setLocation("/push-history")}
                        data-testid="button-go-to-push-history"
                      >
                        Go to Push History
                      </Button>
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
                {/* Push New System Task Section */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Plus className="w-5 h-5" />
                          Create New System Task
                        </CardTitle>
                        <CardDescription>
                          Create a new system installation service with M&E calculated pricing
                        </CardDescription>
                      </div>
                    </div>
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
                              {Array.from({ length: 31 }, (_, i) => {
                                const val = (15 + i * 0.5).toFixed(2);
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
                          <Label htmlFor="newTaskFinancing">Finance Fee %</Label>
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
                          <Label htmlFor="newTaskBurden">Burden %</Label>
                          <div className="relative">
                            <Input
                              id="newTaskBurden"
                              type="number"
                              step="0.5"
                              min="0"
                              max="100"
                              value={laborBurdenPercent}
                              onChange={(e) => setLaborBurdenPercent(e.target.value)}
                              className="pr-7"
                              data-testid="input-new-task-burden"
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
                        <Label htmlFor="newTaskCode" className={newTaskCodeError ? "text-destructive" : ""}>Code *</Label>
                        <Input
                          id="newTaskCode"
                          value={newTaskCode}
                          onChange={(e) => {
                            setNewTaskCode(e.target.value.slice(0, 31));
                            if (newTaskCodeError) setNewTaskCodeError(null);
                          }}
                          placeholder="e.g., 10015"
                          maxLength={31}
                          className={newTaskCodeError ? "border-destructive focus-visible:ring-destructive" : ""}
                          data-testid="input-new-task-code"
                        />
                        {newTaskCodeError ? (
                          <p className="text-sm text-destructive">{newTaskCodeError}</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">{newTaskCode.length}/31 characters</p>
                        )}
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
                        <Label>Account Name</Label>
                        <Input
                          value={newTaskGlAccount}
                          onChange={(e) => setNewTaskGlAccount(e.target.value)}
                          placeholder="Sales"
                          data-testid="input-gl-account"
                        />
                        <p className="text-xs text-muted-foreground">Income account name in ServiceTitan (default: Sales)</p>
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

              <TabsContent value="push-new-repair" className="space-y-6 mt-6">
                {/* Push New Repair Task Section */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Wrench className="w-5 h-5" />
                      Create New Repair Task
                    </CardTitle>
                    <CardDescription>
                      Create a new repair service with materials, labor, and commission-based pricing
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Calculator Section */}
                    <div className="p-4 bg-muted/30 rounded-lg border space-y-4">
                      <h3 className="font-medium text-sm flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-primary" />
                        Repair Price Calculator
                      </h3>
                      
                      {/* Parts & Markup Row */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="repairMaterialsCost">Parts Total</Label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                            <Input
                              id="repairMaterialsCost"
                              type="number"
                              step="0.01"
                              min="0"
                              value={repairMaterialsCost}
                              onChange={(e) => setRepairMaterialsCost(e.target.value)}
                              className="pl-7"
                              data-testid="input-repair-materials-cost"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="repairMarkup">Material Markup</Label>
                          <select
                            id="repairMarkup"
                            value={repairMaterialMarkup}
                            onChange={(e) => setRepairMaterialMarkup(e.target.value)}
                            data-testid="select-repair-markup"
                            className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-2.5 py-1.5 text-sm font-medium ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                          >
                            {Array.from({ length: 30 }, (_, i) => 300 - i * 10).map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}%
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="repairSalesTax">Sales Tax %</Label>
                          <div className="relative">
                            <Input
                              id="repairSalesTax"
                              type="number"
                              step="0.01"
                              min="0"
                              max="20"
                              value={repairSalesTaxPercent}
                              onChange={(e) => setRepairSalesTaxPercent(e.target.value)}
                              className="pr-7"
                              data-testid="input-repair-sales-tax"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                          </div>
                        </div>
                      </div>

                      {/* Labor Row */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-end gap-2">
                          <Label htmlFor="repairLaborMode" className="text-sm font-medium cursor-pointer">
                            Production Pay
                          </Label>
                          <Switch
                            id="repairLaborMode"
                            checked={repairLaborMode === "percent"}
                            onCheckedChange={(checked) => setRepairLaborMode(checked ? "percent" : "dollars")}
                            data-testid="switch-repair-labor-mode"
                          />
                        </div>
                        {repairLaborMode === "percent" ? (
                          <p className="text-xs text-muted-foreground">Labor is included in Commission % below</p>
                        ) : (
                          <>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label htmlFor="repairLaborRate">Labor Rate (per hour)</Label>
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                                  <Input
                                    id="repairLaborRate"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={repairLaborRate}
                                    onChange={(e) => setRepairLaborRate(e.target.value)}
                                    className="pl-7"
                                    data-testid="input-repair-labor-rate"
                                  />
                                </div>
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="repairLaborHours">Labor Hours</Label>
                                <Input
                                  id="repairLaborHours"
                                  type="number"
                                  step="0.25"
                                  min="0"
                                  value={repairLaborHours}
                                  onChange={(e) => setRepairLaborHours(e.target.value)}
                                  data-testid="input-repair-labor-hours"
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label htmlFor="repairHighestTechRate">Highest Tech Pay Rate</Label>
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                                  <Input
                                    id="repairHighestTechRate"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={repairHighestTechRate}
                                    onChange={(e) => setRepairHighestTechRate(e.target.value)}
                                    className="pl-7"
                                    data-testid="input-repair-highest-tech-rate"
                                  />
                                </div>
                                <p className="text-xs text-muted-foreground">Used for gross margin calculation only</p>
                              </div>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Fees Row */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="repairBurden">Burden %</Label>
                          <div className="relative">
                            <Input
                              id="repairBurden"
                              type="number"
                              step="0.01"
                              min="0"
                              max="100"
                              value={repairBurdenPercent}
                              onChange={(e) => setRepairBurdenPercent(e.target.value)}
                              className="pr-7"
                              data-testid="input-repair-burden"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="repairCommission">Commission %</Label>
                          <div className="relative">
                            <Input
                              id="repairCommission"
                              type="number"
                              step="0.01"
                              min="0"
                              max="50"
                              value={repairCommissionPercent}
                              onChange={(e) => setRepairCommissionPercent(e.target.value)}
                              className="pr-7"
                              data-testid="input-repair-commission"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="repairFinancing">Finance Fee %</Label>
                          <div className="relative">
                            <Input
                              id="repairFinancing"
                              type="number"
                              step="0.01"
                              min="0"
                              max="20"
                              value={repairFinancingFeePercent}
                              onChange={(e) => setRepairFinancingFeePercent(e.target.value)}
                              className="pr-7"
                              data-testid="input-repair-financing"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                          </div>
                          <p className="text-xs text-muted-foreground">Financing fee and/or credit card processing fee</p>
                        </div>
                      </div>

                      {/* Round Up Toggle */}
                      <div className="flex items-center justify-end gap-2 pt-1">
                        <Label htmlFor="repairRoundUp" className="text-sm font-medium cursor-pointer">Round Up</Label>
                        <Switch
                          id="repairRoundUp"
                          checked={roundUp}
                          onCheckedChange={setRoundUp}
                          data-testid="switch-repair-round-up"
                        />
                      </div>

                      {/* Price Breakdown */}
                      <div className="bg-background rounded-lg p-4 space-y-3">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Parts Total</span>
                          <span className="font-medium">${repairCalculations.partsTotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Sales Tax ({repairSalesTaxPercent}%)</span>
                          <span className="font-medium">${repairCalculations.salesTax.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{repairMaterialMarkup}% Markup</span>
                          <span className="font-medium">${repairCalculations.markupAmount.toFixed(2)}</span>
                        </div>
                        {repairLaborMode !== "percent" && (
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">
                              Labor ({repairCalculations.laborHours} hrs)
                            </span>
                            <span className="font-medium">${repairCalculations.burdenedLaborCost.toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            {repairLaborMode === "percent" ? "Commission incl. Labor" : "Commission"}
                          </span>
                          <span className="font-medium">${repairCalculations.burdenedCommission.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Finance Fee ({repairFinancingFeePercent}%)</span>
                          <span className="font-medium">${repairCalculations.financingFee.toFixed(2)}</span>
                        </div>
                        
                        {/* COGS & Burden Summary */}
                        <div className="border-t pt-2 space-y-1 bg-muted/30 rounded p-2 -mx-1">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">COGS (Parts + Labor + Commission)</span>
                            <span className="font-medium">${repairCalculations.cogs.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Total Burden</span>
                            <span className="font-medium">${repairCalculations.totalBurden.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Gross Profit</span>
                            <span className={`font-medium ${repairCalculations.grossMarginPercent >= 50 ? 'text-emerald-600' : repairCalculations.grossMarginPercent >= 40 ? 'text-amber-600' : 'text-red-600'}`}>
                              ${repairCalculations.grossMargin.toFixed(2)}
                            </span>
                          </div>
                        </div>

                        <div className="border-t pt-2 flex justify-between items-center">
                          <span className="font-medium">Total Price</span>
                          <span className="text-2xl font-bold text-primary" data-testid="text-repair-price">
                            ${repairCalculatedPrice.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Gross Margin</span>
                          <span className={`font-medium ${repairCalculations.grossMarginPercent >= 50 ? 'text-emerald-600' : repairCalculations.grossMarginPercent >= 40 ? 'text-amber-600' : 'text-red-600'}`}>
                            {repairCalculations.grossMarginPercent.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Task Details Form */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="repairCode" className={repairCodeError ? "text-destructive" : ""}>Code *</Label>
                        <Input
                          id="repairCode"
                          value={repairCode}
                          onChange={(e) => {
                            setRepairCode(e.target.value);
                            if (repairCodeError) setRepairCodeError(null);
                          }}
                          placeholder="e.g., RPR-001"
                          maxLength={31}
                          className={repairCodeError ? "border-destructive focus-visible:ring-destructive" : ""}
                          data-testid="input-repair-code"
                        />
                        {repairCodeError && (
                          <p className="text-sm text-destructive">{repairCodeError}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="repairName">Name *</Label>
                        <Input
                          id="repairName"
                          value={repairName}
                          onChange={(e) => setRepairName(e.target.value)}
                          placeholder="e.g., AC Compressor Repair"
                          data-testid="input-repair-name"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="repairDescription">Description</Label>
                      <Textarea
                        id="repairDescription"
                        value={repairDescription}
                        onChange={(e) => setRepairDescription(e.target.value)}
                        placeholder="Enter repair description..."
                        rows={3}
                        data-testid="input-repair-description"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="repairWarranty">Warranty Description</Label>
                      <Textarea
                        id="repairWarranty"
                        value={repairWarranty}
                        onChange={(e) => setRepairWarranty(e.target.value)}
                        placeholder="Enter warranty terms..."
                        rows={2}
                        data-testid="input-repair-warranty"
                      />
                    </div>

                    {/* Toggles */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="repairTaxable"
                          checked={repairTaxable}
                          onCheckedChange={(checked) => setRepairTaxable(checked === true)}
                          data-testid="checkbox-repair-taxable"
                        />
                        <Label htmlFor="repairTaxable" className="cursor-pointer">Taxable</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="repairAllowDiscounts"
                          checked={repairAllowDiscounts}
                          onCheckedChange={(checked) => setRepairAllowDiscounts(checked === true)}
                          data-testid="checkbox-repair-allow-discounts"
                        />
                        <Label htmlFor="repairAllowDiscounts" className="cursor-pointer">Allow Discount Codes</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="repairAllowMembership"
                          checked={repairAllowMembership}
                          onCheckedChange={(checked) => setRepairAllowMembership(checked === true)}
                          data-testid="checkbox-repair-allow-membership"
                        />
                        <Label htmlFor="repairAllowMembership" className="cursor-pointer">Allow Membership Discounts</Label>
                      </div>
                    </div>

                    {/* GL Account and Category */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Account Name</Label>
                        <Input
                          value={repairGlAccount}
                          onChange={(e) => setRepairGlAccount(e.target.value)}
                          placeholder="Sales"
                          data-testid="input-repair-gl-account"
                        />
                        <p className="text-xs text-muted-foreground">Income account name in ServiceTitan (default: Sales)</p>
                      </div>

                      <div className="space-y-2">
                        <Label>Category *</Label>
                        <Popover open={repairCategorySelectOpen} onOpenChange={setRepairCategorySelectOpen}>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              role="combobox"
                              aria-expanded={repairCategorySelectOpen}
                              className="w-full justify-between"
                              data-testid="button-select-repair-category"
                            >
                              {repairCategoryId
                                ? categories.find(c => c.id === repairCategoryId)?.name || "Select..."
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
                                    const parentCats = activeCategories.filter(c => !c.parentId);
                                    const getChildCats = (parentId: number) => 
                                      activeCategories.filter(c => c.parentId === parentId);
                                    
                                    const renderCat = (category: Category, depth: number = 0): React.ReactNode[] => {
                                      const children = getChildCats(category.id);
                                      const items: React.ReactNode[] = [
                                        <CommandItem
                                          key={category.id}
                                          value={category.name}
                                          onSelect={() => {
                                            setRepairCategoryId(category.id === repairCategoryId ? null : category.id);
                                            setRepairCategorySelectOpen(false);
                                          }}
                                          className={depth > 0 ? "pl-6" : ""}
                                        >
                                          <Check
                                            className={cn(
                                              "mr-2 h-4 w-4",
                                              repairCategoryId === category.id ? "opacity-100" : "opacity-0"
                                            )}
                                          />
                                          <span className={depth > 0 ? "text-muted-foreground" : "font-medium"}>
                                            {depth > 0 ? "└ " : ""}{category.name}
                                          </span>
                                        </CommandItem>
                                      ];
                                      children.forEach(child => {
                                        items.push(...renderCat(child, depth + 1));
                                      });
                                      return items;
                                    };
                                    
                                    return parentCats.flatMap(cat => renderCat(cat, 0));
                                  })()}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>

                    {/* Image Upload */}
                    <div className="space-y-2">
                      <Label>Image (optional)</Label>
                      <div className="flex items-start gap-4">
                        <div className="flex-1">
                          <label
                            htmlFor="repairTaskImage"
                            className="flex items-center justify-center gap-2 h-24 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                          >
                            <ImagePlus className="w-6 h-6 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">
                              {repairImage ? repairImage.name : "Click to upload image"}
                            </span>
                          </label>
                          <input
                            id="repairTaskImage"
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleRepairImageSelect}
                            data-testid="input-repair-task-image"
                          />
                        </div>
                        {repairImagePreview && (
                          <div className="relative">
                            <img
                              src={repairImagePreview}
                              alt="Preview"
                              className="w-24 h-24 object-cover rounded-lg border"
                            />
                            <Button
                              variant="destructive"
                              size="icon"
                              className="absolute -top-2 -right-2 w-6 h-6"
                              onClick={() => {
                                setRepairImage(null);
                                setRepairImagePreview(null);
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
                        onClick={handleCreateRepair}
                        disabled={isCreatingRepair || !repairCode || !repairName || !repairCategoryId}
                        className="gap-2"
                        data-testid="button-create-repair-task"
                      >
                        {isCreatingRepair ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Wrench className="w-4 h-4" />
                        )}
                        Create Repair Task
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
