import { Link, useLocation } from "wouter";
import { Calculator, Settings, History, Menu, X } from "lucide-react";
import { useState } from "react";
import clsx from "clsx";

export function Navigation() {
  const [location] = useLocation();
  const [isOpen, setIsOpen] = useState(false);

  const navItems = [
    { href: "/", label: "Complete System Calculator", icon: Calculator },
    { href: "/history", label: "History", icon: History },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

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
        "fixed inset-y-0 left-0 z-40 w-64 bg-card border-r border-border transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static",
        isOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
      )}>
        <div className="h-full flex flex-col p-6">
          <div className="hidden lg:block mb-8">
            <h1 className="font-display font-bold text-2xl text-primary flex items-center gap-2">
              <Calculator className="w-8 h-8" />
              PricebookCalc
            </h1>
          </div>

          <div className="space-y-2 flex-1">
            {navItems.map((item) => {
              const isActive = location === item.href;
              return (
                <Link key={item.href} href={item.href}>
                  <div className={clsx(
                    "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer font-medium",
                    isActive 
                      ? "bg-primary/10 text-primary shadow-sm" 
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                  onClick={() => setIsOpen(false)}
                  >
                    <item.icon size={20} className={isActive ? "stroke-[2.5px]" : "stroke-2"} />
                    {item.label}
                  </div>
                </Link>
              );
            })}
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
