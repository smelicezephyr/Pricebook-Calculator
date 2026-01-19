import { useQuotes, useDeleteQuote } from "@/hooks/use-quotes";
import { format } from "date-fns";
import { Loader2, Trash2, Search, Calendar, DollarSign, Users, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import clsx from "clsx";

export default function History() {
  const { data: quotes, isLoading } = useQuotes();
  const deleteQuote = useDeleteQuote();
  const [search, setSearch] = useState("");

  const formatCurrency = (val: string | number) => 
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(val));

  const filteredQuotes = quotes?.filter(q => 
    q.title.toLowerCase().includes(search.toLowerCase())
  );

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
          <h1 className="text-3xl font-display font-bold text-foreground">Quote History</h1>
          <p className="text-muted-foreground mt-1">Manage your saved calculations.</p>
        </div>
        
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input 
            placeholder="Search quotes..." 
            className="pl-9 bg-card"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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
              <div className="p-5 flex-1">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="font-semibold text-lg line-clamp-1 group-hover:text-primary transition-colors">
                    {quote.title}
                  </h3>
                  <div className="flex items-center text-xs text-muted-foreground whitespace-nowrap bg-muted px-2 py-1 rounded-full">
                    <Calendar className="w-3 h-3 mr-1" />
                    {quote.createdAt ? format(new Date(quote.createdAt), "MMM d, yyyy") : "Unknown"}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-primary/5 rounded-lg">
                    <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-primary" /> Total Price
                    </span>
                    <span className="text-lg font-bold text-primary">
                      {formatCurrency(quote.calculatedPrice)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-emerald-500/5 rounded-lg">
                    <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <Users className="w-4 h-4 text-emerald-600" /> Est. Labor
                    </span>
                    <span className="text-lg font-bold text-emerald-700">
                      {formatCurrency(quote.calculatedEstimatedLabor)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-border">
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground uppercase font-bold">Margin</p>
                      <p className="font-mono font-medium">{quote.calculatedGrossMargin}%</p>
                    </div>
                    <div className="text-center border-l border-border">
                      <p className="text-xs text-muted-foreground uppercase font-bold">Materials</p>
                      <p className="font-mono font-medium">{formatCurrency(quote.materialsCost)}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-5 py-3 bg-muted/30 border-t border-border flex justify-between items-center">
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
