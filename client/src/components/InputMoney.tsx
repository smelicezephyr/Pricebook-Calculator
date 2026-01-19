import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DollarSign, Percent } from "lucide-react";
import clsx from "clsx";

interface InputMoneyProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  type?: "currency" | "percent" | "number";
  error?: string;
  className?: string;
}

export function InputMoney({ label, type = "currency", error, className, ...props }: InputMoneyProps) {
  return (
    <div className={clsx("space-y-2", className)}>
      <Label className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        {label}
      </Label>
      <div className="relative group">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none group-focus-within:text-primary transition-colors">
          {type === "currency" && <DollarSign size={16} />}
          {type === "percent" && <Percent size={16} />}
          {type === "number" && <span className="text-sm font-mono">#</span>}
        </div>
        <Input
          {...props}
          type="number"
          step={type === "number" ? "1" : "0.01"}
          className={clsx(
            "pl-9 h-12 text-lg font-medium bg-background border-border shadow-sm transition-all focus:ring-primary/20",
            error && "border-destructive focus:ring-destructive/20"
          )}
        />
      </div>
      {error && <span className="text-xs text-destructive font-medium">{error}</span>}
    </div>
  );
}
