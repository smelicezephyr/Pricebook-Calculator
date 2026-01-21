import { useState } from "react";
import { useTenants } from "@/hooks/use-tenants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertTenantSchema } from "@shared/schema";
import { Loader2, Plus, Trash2, Edit, Building2, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { useLocation } from "wouter";
import type { z } from "zod";
import type { Tenant } from "@shared/schema";

type TenantFormValues = z.infer<typeof insertTenantSchema>;

export default function Tenants() {
  const { tenants, isLoading, createTenant, updateTenant, deleteTenant, isCreating, isUpdating } = useTenants();
  const [, setLocation] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<number, boolean>>({});

  const form = useForm<TenantFormValues>({
    resolver: zodResolver(insertTenantSchema),
    defaultValues: {
      name: "",
      tenantId: "",
      clientId: "",
      clientSecret: "",
      appKey: "",
      isActive: true,
    },
  });

  const openCreate = () => {
    setEditingTenant(null);
    form.reset({
      name: "",
      tenantId: "",
      clientId: "",
      clientSecret: "",
      appKey: "",
      isActive: true,
    });
    setIsOpen(true);
  };

  const openEdit = (tenant: Tenant) => {
    setEditingTenant(tenant);
    form.reset({
      name: tenant.name,
      tenantId: tenant.tenantId,
      clientId: tenant.clientId,
      clientSecret: tenant.clientSecret,
      appKey: tenant.appKey,
      isActive: tenant.isActive,
    });
    setIsOpen(true);
  };

  const onSubmit = (data: TenantFormValues) => {
    if (editingTenant) {
      updateTenant({ id: editingTenant.id, data });
    } else {
      createTenant(data);
    }
    setIsOpen(false);
  };

  const toggleShowSecret = (id: number) => {
    setShowSecrets(prev => ({ ...prev, [id]: !prev[id] }));
  };

  if (isLoading) {
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
          <h1 className="text-3xl font-display font-bold text-foreground">ServiceTitan Tenants</h1>
          <p className="text-muted-foreground mt-1">Manage your ServiceTitan API connections.</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="ghost" 
            onClick={() => setLocation("/")}
            className="gap-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={16} />
            Back
          </Button>
          <Button onClick={openCreate} className="gap-2">
            <Plus size={16} />
            Add Tenant
          </Button>
        </div>
      </div>

      {tenants.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Building2 className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No tenants configured</h3>
            <p className="text-muted-foreground text-center mb-4">
              Add your first ServiceTitan tenant to start syncing pricebook data.
            </p>
            <Button onClick={openCreate} className="gap-2">
              <Plus size={16} />
              Add Tenant
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {tenants.map((tenant) => (
            <Card key={tenant.id} className="overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between gap-4 py-4">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${tenant.isActive ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                  <CardTitle className="text-lg">{tenant.name}</CardTitle>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(tenant)} data-testid={`button-edit-tenant-${tenant.id}`}>
                    <Edit size={16} />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => deleteTenant(tenant.id)}
                    className="text-destructive hover:text-destructive"
                    data-testid={`button-delete-tenant-${tenant.id}`}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0 pb-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs font-medium mb-1">Tenant ID</p>
                    <p className="font-mono">{tenant.tenantId}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs font-medium mb-1">Client ID</p>
                    <p className="font-mono truncate">{tenant.clientId.substring(0, 12)}...</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs font-medium mb-1">Client Secret</p>
                    <div className="flex items-center gap-2">
                      <p className="font-mono">
                        {showSecrets[tenant.id] ? tenant.clientSecret.substring(0, 12) + '...' : '••••••••'}
                      </p>
                      <button onClick={() => toggleShowSecret(tenant.id)} className="text-muted-foreground hover:text-foreground">
                        {showSecrets[tenant.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs font-medium mb-1">App Key</p>
                    <p className="font-mono truncate">{tenant.appKey.substring(0, 12)}...</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingTenant ? "Edit Tenant" : "Add Tenant"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., Main Company" data-testid="input-tenant-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="tenantId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tenant ID</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="ServiceTitan Tenant ID" data-testid="input-tenant-id" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="clientId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Client ID</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="OAuth Client ID" data-testid="input-client-id" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="clientSecret"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Client Secret</FormLabel>
                    <FormControl>
                      <Input {...field} type="password" placeholder="OAuth Client Secret" data-testid="input-client-secret" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="appKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Application Key</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="ServiceTitan App Key" data-testid="input-app-key" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isCreating || isUpdating}>
                  {(isCreating || isUpdating) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingTenant ? "Update" : "Add"} Tenant
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
