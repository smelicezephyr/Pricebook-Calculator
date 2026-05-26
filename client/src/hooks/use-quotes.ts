import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type InsertQuote } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

export function useQuotes() {
  return useQuery({
    queryKey: [api.quotes.list.path],
    queryFn: async () => {
      const res = await fetch(api.quotes.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch quotes");
      return api.quotes.list.responses[200].parse(await res.json());
    },
  });
}

export function useCreateQuote() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: InsertQuote) => {
      const res = await fetch(api.quotes.create.path, {
        method: api.quotes.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });

      if (!res.ok) {
        if (res.status === 400) {
          const error = api.quotes.create.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        throw new Error("Failed to save quote");
      }
      return api.quotes.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.quotes.list.path] });
      toast({
        title: "Quote Saved",
        description: "The calculation has been saved to your history.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useDeleteQuote() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.quotes.delete.path, { id });
      const res = await fetch(url, { 
        method: api.quotes.delete.method, 
        credentials: "include" 
      });
      
      if (!res.ok) {
        if (res.status === 404) throw new Error("Quote not found");
        throw new Error("Failed to delete quote");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.quotes.list.path] });
      toast({
        title: "Quote Deleted",
        description: "The saved calculation has been removed.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useClearQuotes() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/quotes", {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to clear quotes");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.quotes.list.path] });
      toast({ title: "All quotes cleared", description: "Your saved quotes have been removed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to clear quotes.", variant: "destructive" });
    },
  });
}
