import { useState } from "react";
import { useServiceTitanAuth } from "@/contexts/ServiceTitanAuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Lock, AlertCircle, Loader2 } from "lucide-react";

interface PasswordGateProps {
  children: React.ReactNode;
}

export function PasswordGate({ children }: PasswordGateProps) {
  const { isUnlocked, isLoading: isCheckingAuth, unlock } = useServiceTitanAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Show loading while checking auth status with server
  if (isCheckingAuth) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (isUnlocked) {
    return <>{children}</>;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const success = await unlock(password);
    setIsLoading(false);
    if (!success) {
      setError(true);
      setPassword("");
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Lock className="w-6 h-6 text-primary" />
          </div>
          <CardTitle>ServiceTitan Access</CardTitle>
          <CardDescription>
            Enter the password to access ServiceTitan integration features.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Input
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(false);
                }}
                className={error ? "border-destructive" : ""}
                data-testid="input-password"
                autoFocus
              />
              {error && (
                <p className="text-sm text-destructive mt-2 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />
                  Incorrect password
                </p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-unlock">
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {isLoading ? "Verifying..." : "Unlock"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
