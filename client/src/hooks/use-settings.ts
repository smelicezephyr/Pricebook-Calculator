import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import type { InsertSettings } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

const LOCAL_SETTINGS_KEY = "pricebookcalc_settings";

function getLocalSettings(): Partial<InsertSettings> | null {
  try {
    const stored = localStorage.getItem(LOCAL_SETTINGS_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return null;
}

function saveLocalSettings(data: InsertSettings) {
  try {
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(data));
  } catch {}
}

export function useSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: [api.settings.get.path],
    queryFn: async () => {
      const res = await fetch(api.settings.get.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch settings");
      const serverSettings = api.settings.get.responses[200].parse(await res.json());
      const localSettings = getLocalSettings();
      if (localSettings) {
        return { ...serverSettings, ...localSettings, id: serverSettings.id };
      }
      return serverSettings;
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: InsertSettings) => {
      saveLocalSettings(data);

      const res = await fetch(api.settings.update.path, {
        method: api.settings.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      
      if (!res.ok) {
        if (res.status === 400) {
          const error = api.settings.update.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        throw new Error("Failed to update settings");
      }
      
      return api.settings.update.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.settings.get.path] });
      toast({
        title: "Settings Saved",
        description: "Your settings have been saved to this device.",
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

  return {
    settings: settingsQuery.data,
    isLoading: settingsQuery.isLoading,
    isError: settingsQuery.isError,
    updateSettings: updateSettingsMutation.mutate,
    isUpdating: updateSettingsMutation.isPending,
  };
}
