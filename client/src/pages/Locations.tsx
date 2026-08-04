import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Trash2, Edit, MapPin, ArrowLeft, Search } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import type { Location } from "@shared/schema";

export default function Locations() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [name, setName] = useState("");
  const [salesTaxPercent, setSalesTaxPercent] = useState("");
  const [zipInput, setZipInput] = useState("");
  const [zipLooking, setZipLooking] = useState(false);

  const { data: locations = [], isLoading } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; salesTaxPercent: string }) => {
      const res = await apiRequest("POST", "/api/locations", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      setIsOpen(false);
      toast({ title: "Location added" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { name: string; salesTaxPercent: string } }) => {
      const res = await apiRequest("PUT", `/api/locations/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      setIsOpen(false);
      toast({ title: "Location updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/locations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Location deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditingLocation(null);
    setName("");
    setSalesTaxPercent("");
    setZipInput("");
    setIsOpen(true);
  };

  const openEdit = (loc: Location) => {
    setEditingLocation(loc);
    setName(loc.name);
    setSalesTaxPercent(loc.salesTaxPercent);
    setZipInput("");
    setIsOpen(true);
  };

  const handleZipLookup = async () => {
    if (!/^\d{5}$/.test(zipInput.trim())) {
      toast({ title: "Enter a valid 5-digit zip code", variant: "destructive" });
      return;
    }
    setZipLooking(true);
    try {
      const res = await fetch(`/api/tax-rate/${zipInput.trim()}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Lookup failed");
      setSalesTaxPercent(data.combinedRate.toFixed(2));
      if (!name.trim()) setName(`${data.city}, ${data.state}`);
      toast({ title: `Rate found: ${data.combinedRate}%`, description: `${data.city}, ${data.state}` });
    } catch (err: any) {
      toast({ title: "Lookup failed", description: err.message, variant: "destructive" });
    } finally {
      setZipLooking(false);
    }
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      toast({ title: "Error", description: "Location name is required", variant: "destructive" });
      return;
    }
    const taxVal = parseFloat(salesTaxPercent);
    if (isNaN(taxVal) || taxVal < 0) {
      toast({ title: "Error", description: "Sales tax must be a valid number", variant: "destructive" });
      return;
    }
    const data = { name: name.trim(), salesTaxPercent: taxVal.toFixed(2) };
    if (editingLocation) {
      updateMutation.mutate({ id: editingLocation.id, data });
    } else {
      createMutation.mutate(data);
    }
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
          <h1 className="text-3xl font-display font-bold text-foreground">Locations</h1>
          <p className="text-muted-foreground mt-1">Manage location-to-sales-tax mappings for tenants.</p>
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
          <Button onClick={openCreate} className="gap-2" data-testid="button-add-location">
            <Plus size={16} />
            Add Location
          </Button>
        </div>
      </div>

      {locations.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <MapPin className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No locations configured</h3>
            <p className="text-muted-foreground text-center mb-4">
              Add locations to assign sales tax rates to your tenants.
            </p>
            <Button onClick={openCreate} className="gap-2">
              <Plus size={16} />
              Add Location
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {locations.map((loc) => (
            <Card key={loc.id}>
              <CardHeader className="flex flex-row items-center justify-between gap-4 py-4">
                <div className="flex items-center gap-3">
                  <MapPin size={18} className="text-muted-foreground" />
                  <div>
                    <CardTitle className="text-base" data-testid={`text-location-name-${loc.id}`}>{loc.name}</CardTitle>
                    <p className="text-sm text-muted-foreground" data-testid={`text-location-tax-${loc.id}`}>
                      Sales Tax: {loc.salesTaxPercent}%
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(loc)} data-testid={`button-edit-location-${loc.id}`}>
                    <Edit size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteMutation.mutate(loc.id)}
                    className="text-destructive hover:text-destructive"
                    disabled={deleteMutation.isPending}
                    data-testid={`button-delete-location-${loc.id}`}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingLocation ? "Edit Location" : "Add Location"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="locationName">Location Name</Label>
              <Input
                id="locationName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Gaithersburg, MD"
                data-testid="input-location-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="locationTax">Sales Tax %</Label>
              <div className="flex gap-2">
                <Input
                  id="locationTax"
                  type="number"
                  step="0.01"
                  min="0"
                  value={salesTaxPercent}
                  onChange={(e) => setSalesTaxPercent(e.target.value)}
                  placeholder="e.g., 6.35"
                  data-testid="input-location-tax"
                />
                <Input
                  value={zipInput}
                  onChange={(e) => setZipInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleZipLookup())}
                  placeholder="Zip"
                  maxLength={5}
                  className="w-24"
                  data-testid="input-zip-lookup"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleZipLookup}
                  disabled={zipLooking}
                  className="shrink-0"
                >
                  {zipLooking ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Enter a zip code and click search to auto-fill the tax rate.</p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-submit-location"
            >
              {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingLocation ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
