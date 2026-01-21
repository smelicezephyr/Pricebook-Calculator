import { Link, useLocation } from "wouter";
import { Calculator, Settings, History, Menu, X, Upload, Building2, ChevronDown, Lock } from "lucide-react";
import { useState } from "react";
import clsx from "clsx";
import { useServiceTitanAuth } from "@/contexts/ServiceTitanAuthContext";

export function Navigation() {
  const [location] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [stExpanded, setStExpanded] = useState(() => {
    return location.startsWith("/push") || location.startsWith("/tenants");
  });
  const { isUnlocked, lock } = useServiceTitanAuth();

  const mainNavItems = [
    { href: "/", label: "Complete System Calculator", icon: Calculator },
    { href: "/history", label: "History", icon: History },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  const stNavItems = [
    { href: "/push", label: "Push to Pricebook", icon: Upload },
    { href: "/tenants", label: "Manage Tenants", icon: Building2 },
  ];

  const isStActive = location.startsWith("/push") || location.startsWith("/tenants");

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
            {/* Calculator link */}
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
                Calculator
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
