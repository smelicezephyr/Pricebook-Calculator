import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Tenant, InsertTenant } from "@shared/schema";

export function useTenants() {
  const { data: tenants = [], isLoading } = useQuery<Tenant[]>({
    queryKey: ["/api/tenants"],
  });

  const createMutation = useMutation({
    mutationFn: (data: InsertTenant) =>
      apiRequest("POST", "/api/tenants", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<InsertTenant> }) =>
      apiRequest("PUT", `/api/tenants/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/tenants/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (orderedIds: number[]) =>
      apiRequest("POST", "/api/tenants/reorder", { orderedIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
    },
  });

  return {
    tenants,
    isLoading,
    createTenant: createMutation.mutate,
    updateTenant: updateMutation.mutate,
    deleteTenant: deleteMutation.mutate,
    reorderTenants: reorderMutation.mutate,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isReordering: reorderMutation.isPending,
  };
}

export function useServiceTitan(tenantId: number | null) {
  const testConnectionMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("POST", `/api/servicetitan/${id}/test`),
  });

  const { data: categories = [], isLoading: isCategoriesLoading, refetch: fetchCategories } = useQuery<any[]>({
    queryKey: ["/api/servicetitan", tenantId, "categories"],
    queryFn: () => fetch(`/api/servicetitan/${tenantId}/categories`).then(r => r.json()),
    enabled: false,
  });

  const { data: services = [], isLoading: isServicesLoading, refetch: fetchServices } = useQuery<any[]>({
    queryKey: ["/api/servicetitan", tenantId, "services"],
    queryFn: () => fetch(`/api/servicetitan/${tenantId}/services`).then(r => r.json()),
    enabled: false,
  });

  return {
    testConnection: testConnectionMutation.mutateAsync,
    isTesting: testConnectionMutation.isPending,
    categories,
    isCategoriesLoading,
    fetchCategories,
    services,
    isServicesLoading,
    fetchServices,
  };
}
