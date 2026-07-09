import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Eye, Loader2 } from "lucide-react";

interface RevealPriceGateProps {
  locked: boolean;
  onReveal: (jobNumber: string, customerName: string) => Promise<void> | void;
  isSaving?: boolean;
  children: React.ReactNode;
}

export function RevealPriceGate({ locked, onReveal, isSaving, children }: RevealPriceGateProps) {
  const [open, setOpen] = useState(false);
  const [jobNumber, setJobNumber] = useState("");
  const [customerName, setCustomerName] = useState("");

  if (!locked) return <>{children}</>;

  const handleConfirm = async () => {
    if (!jobNumber.trim()) return;
    await onReveal(jobNumber.trim(), customerName.trim());
    setOpen(false);
    setJobNumber("");
    setCustomerName("");
  };

  return (
    <div
      className="bg-card border border-dashed border-border rounded-xl p-10 flex flex-col items-center justify-center text-center gap-3 min-h-[240px]"
      data-testid="reveal-price-gate"
    >
      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
        <Lock className="w-6 h-6 text-muted-foreground" />
      </div>
      <p className="font-display font-semibold text-lg">Price Hidden</p>
      <p className="text-sm text-muted-foreground max-w-sm">
        Enter a job number to reveal and save this quote for your records.
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button className="gap-2 mt-2" data-testid="button-reveal-price">
            <Eye size={16} />
            Reveal Price
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reveal Price</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Job Number *</Label>
              <Input
                value={jobNumber}
                onChange={(e) => setJobNumber(e.target.value)}
                placeholder="e.g. 12345"
                data-testid="input-job-number"
              />
            </div>
            <div className="space-y-2">
              <Label>Customer Name (optional)</Label>
              <Input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="e.g. John Smith"
                data-testid="input-customer-name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!jobNumber.trim() || isSaving}
              data-testid="button-confirm-reveal"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Reveal & Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
