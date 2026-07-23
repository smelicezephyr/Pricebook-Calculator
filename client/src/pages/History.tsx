import { useQuotes, useDeleteQuote, useClearQuotes } from "@/hooks/use-quotes";
import { useTenants } from "@/hooks/use-tenants";
import { format } from "date-fns";
import { Loader2, Trash2, Search, Calendar, DollarSign, Users, User, Wrench, Flame, ArrowUpDown, Building2, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState, useMemo } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import clsx from "clsx";

type SortOption = "date" | "type";

export default function History() {
  const { data: quotes, isLoading } = useQuotes();
  const { tenants } = useTenants();
  const deleteQuote = useDeleteQuote();
  const clearQuotes = useClearQuotes();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("date");
  const [tenantFilter, setTenantFilter] = useState<string>("all");

  const tenantNameById = useMemo(
    () => new Map(tenants.map(t => [t.id, t.name])),
    [tenants]
  );

  const formatCurrency = (val: string | number) => 
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(val));

  const isSystemQuote = (equipmentCost: string | number) => Number(equipmentCost) > 0;

  const filteredQuotes = useMemo(() => {
    const filtered = quotes?.filter(q => 
      q.title.toLowerCase().includes(search.toLowerCase()) &&
      (tenantFilter === "all" || String(q.tenantId ?? "") === tenantFilter)
    );
    if (!filtered) return filtered;

    const sorted = [...filtered];
    if (sortBy === "type") {
      sorted.sort((a, b) => {
        const aType = isSystemQuote(a.equipmentCost) ? "System" : "Repair";
        const bType = isSystemQuote(b.equipmentCost) ? "System" : "Repair";
        if (aType !== bType) return aType.localeCompare(bType);
        return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
      });
    } else {
      sorted.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    }
    return sorted;
  }, [quotes, search, sortBy, tenantFilter]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Saved Quotes</h1>
          <p className="text-muted-foreground mt-1">Manage your saved calculations.</p>
        </div>
        
        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input 
              placeholder="Search quotes..." 
              className="pl-9 bg-card"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search-quotes"
            />
          </div>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
            <SelectTrigger className="w-[150px] bg-card shrink-0" data-testid="select-sort-quotes">
              <ArrowUpDown className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date" data-testid="option-sort-date">Sort by Date</SelectItem>
              <SelectItem value="type" data-testid="option-sort-type">Sort by Type</SelectItem>
            </SelectContent>
          </Select>
          {tenants.length > 0 && (
            <Select value={tenantFilter} onValueChange={setTenantFilter}>
              <SelectTrigger className="w-[170px] bg-card shrink-0" data-testid="select-filter-tenant">
                <Building2 className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                <SelectValue placeholder="Tenant" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="option-tenant-all">All Tenants</SelectItem>
                {tenants.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)} data-testid={`option-tenant-${t.id}`}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {(quotes?.length ?? 0) > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive border-destructive/40 hover:bg-destructive/10 shrink-0"
                  disabled={clearQuotes.isPending}
                  data-testid="button-clear-all-quotes"
                >
                  {clearQuotes.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  <span className="ml-1">Clear All</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear all saved quotes?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all {quotes?.length} of your saved quotes. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => clearQuotes.mutate()}
                    className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                    data-testid="button-confirm-clear-all"
                  >
                    Clear All
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {!filteredQuotes?.length ? (
        <div className="text-center py-20 bg-muted/20 rounded-2xl border border-dashed border-border">
          <div className="bg-muted w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">No quotes found</h3>
          <p className="text-muted-foreground max-w-sm mx-auto mt-2">
            {quotes?.length ? "Try adjusting your search terms." : "Start by creating a quote in the calculator."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredQuotes.map((quote) => (
            <div 
              key={quote.id} 
              className="bg-card rounded-xl border border-border shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden group flex flex-col"
            >
              <div className="p-4 flex-1">
                <div className="flex justify-between items-start mb-2.5 gap-2">
                  <h3 className="font-semibold text-lg line-clamp-1 group-hover:text-primary transition-colors">
                    {quote.title}
                  </h3>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <div
                      className={clsx(
                        "flex items-center text-xs font-bold whitespace-nowrap px-2 py-0.5 rounded-full text-white shadow-sm",
                        isSystemQuote(quote.equipmentCost)
                          ? "bg-blue-600"
                          : "bg-orange-500"
                      )}
                      data-testid={`badge-type-${quote.id}`}
                    >
                      {isSystemQuote(quote.equipmentCost)
                        ? <Flame className="w-3 h-3 mr-1" />
                        : <Wrench className="w-3 h-3 mr-1" />}
                      {isSystemQuote(quote.equipmentCost) ? "System" : "Repair"}
                    </div>
                    <div className="flex items-center text-xs text-muted-foreground whitespace-nowrap bg-muted px-2 py-0.5 rounded-full">
                      <Calendar className="w-3 h-3 mr-1" />
                      {quote.createdAt ? format(new Date(quote.createdAt), "MMM d, yyyy") : "Unknown"}
                    </div>
                    {(quote as any).afterHours && (
                      <div
                        className="flex items-center text-xs font-bold whitespace-nowrap px-2 py-0.5 rounded-full bg-red-600 text-white"
                        data-testid={`badge-after-hours-${quote.id}`}
                      >
                        <Moon className="w-3 h-3 mr-1" />
                        After Hours
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center text-xs text-muted-foreground" data-testid={`text-created-by-${quote.id}`}>
                    <User className="w-3 h-3 mr-1" />
                    Added by {quote.userName || "Unknown"}
                  </div>
                  {quote.tenantId && tenantNameById.get(quote.tenantId) && (
                    <div
                      className="flex items-center text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full whitespace-nowrap"
                      data-testid={`badge-tenant-${quote.id}`}
                    >
                      <Building2 className="w-3 h-3 mr-1" />
                      {tenantNameById.get(quote.tenantId)}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between p-2 bg-primary/5 rounded-lg">
                    <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-primary" /> Total Price
                    </span>
                    <span className="flex items-baseline justify-end gap-1.5">
                      <span className="text-lg font-bold text-primary font-mono tabular-nums text-right">
                        {formatCurrency(quote.calculatedPrice)}
                      </span>
                      <span className="text-xs font-medium text-transparent w-12 text-right select-none">
                        (0.0%)
                      </span>
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-2 bg-sky-500/5 rounded-lg">
                    <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-sky-600" />
                      {Number(quote.equipmentCost) > 0 ? "M&E" : "Parts Total"}
                    </span>
                    <span className="flex items-baseline justify-end gap-1.5">
                      <span className="text-lg font-bold text-sky-700 font-mono tabular-nums text-right">
                        {Number(quote.equipmentCost) > 0
                          ? formatCurrency(Number(quote.materialsCost) + Number(quote.equipmentCost))
                          : formatCurrency(quote.materialsCost)}
                      </span>
                      <span className="text-xs font-medium text-sky-600/70 font-mono tabular-nums w-12 text-right">
                        ({Number(quote.calculatedMePercent).toFixed(1)}%)
                      </span>
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-2 bg-emerald-500/5 rounded-lg">
                    <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <Users className="w-4 h-4 text-emerald-600" />
                      {quote.calculatedLaborRate && Number(quote.calculatedLaborRate) > 0 ? "Labor Rate" : "Direct Labor"}
                    </span>
                    <span className="flex items-baseline justify-end gap-1.5">
                      <span className="text-lg font-bold text-emerald-700 font-mono tabular-nums text-right">
                        {quote.calculatedLaborRate && Number(quote.calculatedLaborRate) > 0
                          ? `${formatCurrency(quote.calculatedLaborRate)}/hr`
                          : formatCurrency(quote.calculatedEstimatedLabor)}
                      </span>
                      <span className="text-xs font-medium text-emerald-600/70 font-mono tabular-nums w-12 text-right">
                        ({Number(quote.calculatedPrice) > 0
                          ? ((Number(quote.calculatedEstimatedLabor) / Number(quote.calculatedPrice)) * 100).toFixed(1)
                          : "0.0"}%)
                      </span>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-1 pt-2 border-t border-border">
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground uppercase font-bold">Margin $</p>
                      <p className="font-mono font-medium">
                        {formatCurrency((Number(quote.calculatedPrice) * Number(quote.calculatedGrossMargin)) / 100)}
                      </p>
                    </div>
                    <div className="text-center border-l border-border">
                      <p className="text-xs text-muted-foreground uppercase font-bold">Margin %</p>
                      <p className="font-mono font-medium">{quote.calculatedGrossMargin}%</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-4 py-2 bg-muted/30 border-t border-border flex justify-between items-center">
                <span className="text-xs text-muted-foreground font-medium">
                  ID: #{quote.id}
                </span>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 -mr-2">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Quote?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone. This will permanently delete the quote 
                        <span className="font-semibold text-foreground"> "{quote.title}"</span>.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction 
                        onClick={() => deleteQuote.mutate(quote.id)}
                        className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
