import { useState, useEffect } from "react";
import { useTenants, useServiceTitan } from "@/hooks/use-tenants";
import { useSettings } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, Upload, Building2, ChevronRight, ArrowLeft, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

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
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [isPushing, setIsPushing] = useState(false);

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

  const toggleCategory = (categoryId: number) => {
    setSelectedCategories(prev => {
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
    if (!selectedTenantId || selectedCategories.size === 0 || !settings) return;
    
    setIsPushing(true);
    try {
      toast({
        title: "Push Started",
        description: `Pushing M&E calculations to ${selectedCategories.size} categories...`,
      });
      
      const response = await fetch(`/api/servicetitan/${selectedTenantId}/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryIds: Array.from(selectedCategories),
          targetMePercent: parseFloat(settings.targetMePercent),
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Push failed");
      }
      
      const results = await response.json();
      
      if (results.errors && results.errors.length > 0) {
        toast({
          title: "Push Completed with Warnings",
          description: `Updated ${results.updated} of ${results.processed} services. ${results.errors.length} errors occurred.`,
        });
      } else {
        toast({
          title: "Push Complete",
          description: `Successfully updated ${results.updated} of ${results.processed} services.`,
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
    }
  };

  const parentCategories = categories.filter(c => !c.parentId);
  const getChildren = (parentId: number) => categories.filter(c => c.parentId === parentId);

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
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">2. Select Categories</CardTitle>
                      <CardDescription>
                        Choose which pricebook categories to apply the M&E calculation
                        {settings && (
                          <Badge variant="secondary" className="ml-2">
                            Target M&E: {settings.targetMePercent}%
                          </Badge>
                        )}
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
                    <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                      {parentCategories.map(parent => {
                        const children = getChildren(parent.id);
                        const hasChildren = children.length > 0;
                        
                        return (
                          <div key={parent.id} className="space-y-1">
                            <div 
                              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                                selectedCategories.has(parent.id) 
                                  ? 'bg-primary/5 border-primary/30' 
                                  : 'border-border hover:bg-muted/50'
                              }`}
                            >
                              <Checkbox
                                id={`category-${parent.id}`}
                                checked={selectedCategories.has(parent.id)}
                                onCheckedChange={() => toggleCategory(parent.id)}
                                disabled={!parent.active}
                                data-testid={`checkbox-category-${parent.id}`}
                              />
                              <label 
                                htmlFor={`category-${parent.id}`}
                                className={`flex-1 cursor-pointer font-medium ${!parent.active ? 'text-muted-foreground' : ''}`}
                              >
                                {parent.name}
                                {!parent.active && <Badge variant="outline" className="ml-2 text-xs">Inactive</Badge>}
                              </label>
                              {hasChildren && (
                                <ChevronRight className="w-4 h-4 text-muted-foreground" />
                              )}
                            </div>
                            
                            {hasChildren && (
                              <div className="ml-6 space-y-1">
                                {children.map(child => (
                                  <div 
                                    key={child.id}
                                    className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                                      selectedCategories.has(child.id) 
                                        ? 'bg-primary/5 border-primary/30' 
                                        : 'border-border hover:bg-muted/50'
                                    }`}
                                  >
                                    <Checkbox
                                      id={`category-${child.id}`}
                                      checked={selectedCategories.has(child.id)}
                                      onCheckedChange={() => toggleCategory(child.id)}
                                      disabled={!child.active}
                                      data-testid={`checkbox-category-${child.id}`}
                                    />
                                    <label 
                                      htmlFor={`category-${child.id}`}
                                      className={`flex-1 cursor-pointer text-sm ${!child.active ? 'text-muted-foreground' : ''}`}
                                    >
                                      {child.name}
                                      {!child.active && <Badge variant="outline" className="ml-2 text-xs">Inactive</Badge>}
                                    </label>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">3. Push Updates</CardTitle>
                  <CardDescription>
                    Apply the M&E percentage calculation to all items in the selected categories
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {selectedCategories.size} categories selected
                      </p>
                    </div>
                    <Button 
                      onClick={handlePush}
                      disabled={selectedCategories.size === 0 || isPushing}
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
