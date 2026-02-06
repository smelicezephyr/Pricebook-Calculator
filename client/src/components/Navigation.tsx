import { Link, useLocation } from "wouter";
import { Calculator, Settings, History, Menu, X, Upload, Building2, ChevronDown, Lock, Clock, Wrench, Shield, Key, Trash2, Loader2, Hash, MapPin } from "lucide-react";
import { useState } from "react";
import clsx from "clsx";
import { useServiceTitanAuth } from "@/contexts/ServiceTitanAuthContext";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

export function Navigation() {
  const [location] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const isServiceTitanPath = location.startsWith("/push") || location.startsWith("/tenants") || location.startsWith("/locations");
  const [stExpanded, setStExpanded] = useState(() => isServiceTitanPath);
  const { isUnlocked, lock, changePassword } = useServiceTitanAuth();
  const { isUnlocked: isAdminUnlocked, isLoading: isAdminLoading, unlock: unlockAdmin, lock: lockAdmin, changePin } = useAdminAuth();
  const { toast } = useToast();
  
  // Admin section state
  const [adminExpanded, setAdminExpanded] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  
  // Admin PIN state
  const [adminPin, setAdminPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [changePinError, setChangePinError] = useState("");
  const [isChangingPin, setIsChangingPin] = useState(false);

  const handleChangePassword = async () => {
    setPasswordError("");
    
    if (!currentPassword) {
      setPasswordError("Current password is required");
      return;
    }
    if (!newPassword) {
      setPasswordError("New password is required");
      return;
    }
    if (newPassword.length < 4) {
      setPasswordError("New password must be at least 4 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match");
      return;
    }
    
    setIsChangingPassword(true);
    const result = await changePassword(currentPassword, newPassword);
    setIsChangingPassword(false);
    
    if (result.success) {
      toast({ title: "Success", description: "Password changed successfully" });
      setPasswordDialogOpen(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } else {
      setPasswordError(result.error || "Failed to change password");
    }
  };

  const handleClearHistory = async () => {
    setIsClearingHistory(true);
    try {
      const response = await fetch("/api/admin/clear-history", { method: "DELETE" });
      const result = await response.json();
      if (result.success) {
        toast({ title: "Success", description: "All history has been cleared" });
        queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      } else {
        toast({ title: "Error", description: result.error || "Failed to clear history", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to clear history", variant: "destructive" });
    } finally {
      setIsClearingHistory(false);
    }
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsVerifyingPin(true);
    setPinError(false);
    
    const success = await unlockAdmin(adminPin);
    
    setIsVerifyingPin(false);
    if (success) {
      setAdminPin("");
    } else {
      setPinError(true);
    }
  };

  const handleChangePin = async () => {
    setChangePinError("");
    
    if (!currentPin) {
      setChangePinError("Current PIN is required");
      return;
    }
    if (!newPin) {
      setChangePinError("New PIN is required");
      return;
    }
    if (newPin.length < 4) {
      setChangePinError("New PIN must be at least 4 characters");
      return;
    }
    if (newPin !== confirmPin) {
      setChangePinError("New PINs do not match");
      return;
    }
    
    setIsChangingPin(true);
    const result = await changePin(currentPin, newPin);
    setIsChangingPin(false);
    
    if (result.success) {
      toast({ title: "Success", description: "PIN changed successfully" });
      setPinDialogOpen(false);
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
    } else {
      setChangePinError(result.error || "Failed to change PIN");
    }
  };

  const mainNavItems = [
    { href: "/", label: "Complete System Calculator", icon: Calculator },
    { href: "/history", label: "History", icon: History },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  const stNavItems = [
    { href: "/push", label: "Push to Pricebook", icon: Upload },
    { href: "/push-history", label: "Push History", icon: Clock },
    { href: "/tenants", label: "Manage Tenants", icon: Building2 },
    { href: "/locations", label: "Manage Locations", icon: MapPin },
  ];

  const isStActive = isServiceTitanPath;

  return (
    <>
      {/* Mobile Header */}
      <div className="lg:hidden flex items-center justify-between p-4 bg-card border-b border-border sticky top-0 z-50">
        <h1 className="font-display font-bold text-xl text-primary">PricebookCalc</h1>
        <button 
          onClick={() => setIsOpen(!isOpen)}
          className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
        >
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Sidebar / Drawer */}
      <nav className={clsx(
        "fixed left-0 z-40 w-64 bg-card border-r border-border transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-y-0",
        "top-[57px] bottom-0 lg:top-0",
        isOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
      )}>
        <div className="h-full flex flex-col p-6 pt-4 lg:pt-6">
          <div className="hidden lg:block mb-8">
            <h1 className="font-display font-bold text-2xl text-primary flex items-center gap-2">
              <Calculator className="w-8 h-8" />
              PricebookCalc
            </h1>
          </div>

          <div className="space-y-2 flex-1">
            {/* System Calculator link */}
            <Link href="/">
              <div className={clsx(
                "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer font-medium",
                location === "/" 
                  ? "bg-primary/10 text-primary shadow-sm" 
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              onClick={() => setIsOpen(false)}
              >
                <Calculator size={20} className={location === "/" ? "stroke-[2.5px]" : "stroke-2"} />
                System Calculator
              </div>
            </Link>

            {/* Repair Calculator link */}
            <Link href="/repair">
              <div className={clsx(
                "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer font-medium",
                location === "/repair" 
                  ? "bg-primary/10 text-primary shadow-sm" 
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              onClick={() => setIsOpen(false)}
              >
                <Wrench size={20} className={location === "/repair" ? "stroke-[2.5px]" : "stroke-2"} />
                Repair Calculator
              </div>
            </Link>

            {/* ServiceTitan Section */}
            <div className="pt-2">
              <button
                onClick={() => setStExpanded(!stExpanded)}
                className={clsx(
                  "w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer font-medium",
                  isStActive 
                    ? "bg-primary/10 text-primary shadow-sm" 
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <div className="flex items-center gap-3">
                  <Upload size={20} className={isStActive ? "stroke-[2.5px]" : "stroke-2"} />
                  ServiceTitan
                  {!isUnlocked && <Lock size={14} className="text-muted-foreground" />}
                </div>
                <ChevronDown 
                  size={16} 
                  className={clsx(
                    "transition-transform duration-200",
                    stExpanded ? "rotate-180" : ""
                  )} 
                />
              </button>
              
              {stExpanded && (
                <div className="ml-4 mt-1 space-y-1 border-l-2 border-border pl-4">
                  {stNavItems.map((item) => {
                    const isActive = location === item.href;
                    return (
                      <Link key={item.href} href={item.href}>
                        <div className={clsx(
                          "flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 cursor-pointer text-sm",
                          isActive 
                            ? "bg-primary/10 text-primary font-medium" 
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        )}
                        onClick={() => setIsOpen(false)}
                        >
                          <item.icon size={16} />
                          {item.label}
                        </div>
                      </Link>
                    );
                  })}
                  {isUnlocked && (
                    <button
                      onClick={() => lock()}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted w-full"
                    >
                      <Lock size={16} />
                      Lock Section
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* History link */}
            <Link href="/history">
              <div className={clsx(
                "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer font-medium",
                location === "/history" 
                  ? "bg-primary/10 text-primary shadow-sm" 
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              onClick={() => setIsOpen(false)}
              >
                <History size={20} className={location === "/history" ? "stroke-[2.5px]" : "stroke-2"} />
                History
              </div>
            </Link>

            {/* Settings link */}
            <Link href="/settings">
              <div className={clsx(
                "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer font-medium",
                location === "/settings" 
                  ? "bg-primary/10 text-primary shadow-sm" 
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              onClick={() => setIsOpen(false)}
              >
                <Settings size={20} className={location === "/settings" ? "stroke-[2.5px]" : "stroke-2"} />
                Settings
              </div>
            </Link>
          </div>

          {/* Admin Section */}
          <div className="pt-2">
            <button
              onClick={() => setAdminExpanded(!adminExpanded)}
              className={clsx(
                "w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer font-medium",
                "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              <div className="flex items-center gap-3">
                <Shield size={20} className="stroke-2" />
                Admin
                {!isAdminUnlocked && <Lock size={14} className="text-muted-foreground" />}
              </div>
              <ChevronDown 
                size={16} 
                className={clsx(
                  "transition-transform duration-200",
                  adminExpanded ? "rotate-180" : ""
                )} 
              />
            </button>
            
            {adminExpanded && (
              <div className="ml-4 mt-1 space-y-1 border-l-2 border-border pl-4">
                {isAdminLoading ? (
                  <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                    <Loader2 size={16} className="animate-spin" />
                    Checking...
                  </div>
                ) : !isAdminUnlocked ? (
                  <form onSubmit={handlePinSubmit} className="space-y-2 p-2">
                    <div className="space-y-1">
                      <Label htmlFor="adminPin" className="text-xs text-muted-foreground">Enter PIN to unlock</Label>
                      <Input
                        id="adminPin"
                        type="password"
                        placeholder="PIN"
                        value={adminPin}
                        onChange={(e) => {
                          setAdminPin(e.target.value);
                          setPinError(false);
                        }}
                        className={clsx("h-8 text-sm", pinError && "border-destructive")}
                        data-testid="input-admin-pin"
                      />
                      {pinError && (
                        <p className="text-xs text-destructive">Invalid PIN</p>
                      )}
                    </div>
                    <Button 
                      type="submit" 
                      size="sm" 
                      className="w-full"
                      disabled={isVerifyingPin || !adminPin}
                      data-testid="button-unlock-admin"
                    >
                      {isVerifyingPin && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                      Unlock
                    </Button>
                  </form>
                ) : (
                  <>
                    {/* Change Password */}
                    <Dialog open={passwordDialogOpen} onOpenChange={(open) => {
                      setPasswordDialogOpen(open);
                      if (!open) {
                        setCurrentPassword("");
                        setNewPassword("");
                        setConfirmPassword("");
                        setPasswordError("");
                      }
                    }}>
                      <DialogTrigger asChild>
                        <button
                          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted w-full"
                          data-testid="button-change-password"
                        >
                          <Key size={16} />
                          Change Password
                        </button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Change ServiceTitan Password</DialogTitle>
                          <DialogDescription>
                            Update the password used to access the ServiceTitan section.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label htmlFor="currentPassword">Current Password</Label>
                            <Input
                              id="currentPassword"
                              type="password"
                              value={currentPassword}
                              onChange={(e) => setCurrentPassword(e.target.value)}
                              data-testid="input-current-password"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="newPassword">New Password</Label>
                            <Input
                              id="newPassword"
                              type="password"
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              data-testid="input-new-password"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="confirmPassword">Confirm New Password</Label>
                            <Input
                              id="confirmPassword"
                              type="password"
                              value={confirmPassword}
                              onChange={(e) => setConfirmPassword(e.target.value)}
                              data-testid="input-confirm-password"
                            />
                          </div>
                          {passwordError && (
                            <p className="text-sm text-destructive">{passwordError}</p>
                          )}
                        </div>
                        <DialogFooter>
                          <Button 
                            onClick={handleChangePassword} 
                            disabled={isChangingPassword}
                            data-testid="button-save-password"
                          >
                            {isChangingPassword && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                            Save Password
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>

                    {/* Change PIN */}
                    <Dialog open={pinDialogOpen} onOpenChange={(open) => {
                      setPinDialogOpen(open);
                      if (!open) {
                        setCurrentPin("");
                        setNewPin("");
                        setConfirmPin("");
                        setChangePinError("");
                      }
                    }}>
                      <DialogTrigger asChild>
                        <button
                          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted w-full"
                          data-testid="button-change-pin"
                        >
                          <Hash size={16} />
                          Change PIN
                        </button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Change Admin PIN</DialogTitle>
                          <DialogDescription>
                            Update the PIN used to access the Admin section.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label htmlFor="currentPin">Current PIN</Label>
                            <Input
                              id="currentPin"
                              type="password"
                              value={currentPin}
                              onChange={(e) => setCurrentPin(e.target.value)}
                              data-testid="input-current-pin"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="newPin">New PIN</Label>
                            <Input
                              id="newPin"
                              type="password"
                              value={newPin}
                              onChange={(e) => setNewPin(e.target.value)}
                              data-testid="input-new-pin"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="confirmPin">Confirm New PIN</Label>
                            <Input
                              id="confirmPin"
                              type="password"
                              value={confirmPin}
                              onChange={(e) => setConfirmPin(e.target.value)}
                              data-testid="input-confirm-pin"
                            />
                          </div>
                          {changePinError && (
                            <p className="text-sm text-destructive">{changePinError}</p>
                          )}
                        </div>
                        <DialogFooter>
                          <Button 
                            onClick={handleChangePin} 
                            disabled={isChangingPin}
                            data-testid="button-save-pin"
                          >
                            {isChangingPin && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                            Save PIN
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>

                    {/* Lock Push Section */}
                    {isUnlocked && (
                      <button
                        onClick={() => lock()}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted w-full"
                        data-testid="button-lock-push-section"
                      >
                        <Lock size={16} />
                        Lock Push Section
                      </button>
                    )}

                    {/* Clear All History */}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button
                          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-destructive hover:text-destructive hover:bg-destructive/10 w-full"
                          data-testid="button-clear-history"
                        >
                          <Trash2 size={16} />
                          Clear All History
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Clear All History?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete all saved quotes and calculation history. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={handleClearHistory}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            disabled={isClearingHistory}
                          >
                            {isClearingHistory && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                            Delete All
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>

                    {/* Lock Admin Section */}
                    <button
                      onClick={() => lockAdmin()}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted w-full"
                      data-testid="button-lock-admin"
                    >
                      <Lock size={16} />
                      Lock Admin
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="mt-auto pt-6 border-t border-border">
            <div className="bg-gradient-to-br from-primary/5 to-primary/10 rounded-xl p-4">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">
                Pro Tip
              </p>
              <p className="text-sm text-foreground">
                Configure your labor burden and tax rates in Settings for accurate quotes.
              </p>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-30 lg:hidden backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
}
