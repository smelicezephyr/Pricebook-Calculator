import { Link, useLocation } from "wouter";
import { Calculator, Settings, History, Menu, X, Upload, Building2, ChevronDown, Clock, Wrench, Shield, MapPin, ArrowLeftRight, LogOut, Users, ScrollText, BarChart2, Target, type LucideIcon } from "lucide-react";
import { useState } from "react";
import clsx from "clsx";
import horizontalLogo from "@assets/Logo_-_Horizontal_1772750848213.png";
import stackedLogo from "@assets/Logo_-_Stacked_1772750848213.png";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function getInitials(name: string) {
  return name.split(" ").map(p => p[0]).join("").toUpperCase().slice(0, 2);
}

export function Navigation() {
  const [location] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const { user, isAdmin, isManager, isUserOrAdmin, isReporting } = useAuth();
  const { toast } = useToast();

  const isServiceTitanPath =
    location.startsWith("/push") ||
    location.startsWith("/tenants") ||
    location.startsWith("/locations");
  const [stExpanded, setStExpanded] = useState(() => isServiceTitanPath);
  const [adminExpanded, setAdminExpanded] = useState(() => location.startsWith("/admin"));
  const [reportingExpanded, setReportingExpanded] = useState(() => location.startsWith("/reporting"));

  const handleSignOut = async () => {
    try {
      await fetch("/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      // ignore network errors
    }
    queryClient.clear();
    window.location.href = "/login";
  };

  const close = () => setIsOpen(false);

  const navLink = (href: string, label: string, Icon: LucideIcon) => {
    const isActive = location === href;
    return (
      <Link href={href}>
        <div
          className={clsx(
            "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer font-medium",
            isActive
              ? "bg-primary/10 text-primary shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
          onClick={close}
        >
          <Icon size={20} className={isActive ? "stroke-[2.5px]" : "stroke-2"} />
          {label}
        </div>
      </Link>
    );
  };

  const stNavItems = [
    { href: "/push", label: "Push to Pricebook", icon: Upload },
    { href: "/push-history", label: "Push History", icon: Clock },
  ];

  if (isAdmin) {
    stNavItems.push(
      { href: "/tenants", label: "Manage Tenants", icon: Building2 },
      { href: "/locations", label: "Manage Locations", icon: MapPin }
    );
  }

  const isStActive = isServiceTitanPath;

  return (
    <>
      {/* Mobile Header */}
      <div className="lg:hidden flex items-center justify-between p-4 bg-card border-b border-border sticky top-0 z-50">
        <img src={stackedLogo} alt="PricebookCalc" className="h-10 w-auto" />
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
          data-testid="button-mobile-menu"
        >
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Sidebar / Drawer */}
      <nav
        className={clsx(
          "fixed left-0 z-40 w-64 bg-card border-r border-border transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-y-0",
          "top-[57px] bottom-0 lg:top-0",
          isOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
        )}
      >
        <div className="h-full flex flex-col p-6 pt-4 lg:pt-6">
          <div className="hidden lg:block mb-8">
            <img src={horizontalLogo} alt="PricebookCalc" className="h-12 w-auto" />
          </div>

          <div className="space-y-2 flex-1 overflow-y-auto">
            {/* Calculator pages — all roles */}
            {navLink("/", "System Gross Margin Calculator", Target)}
            {navLink("/system-me", "System M&E Calculator", Calculator)}
            {navLink("/repair", "Repair Calculator", Wrench)}
            {navLink("/repair-gm", "Repair GM Calculator", Target)}
            {navLink("/reverse", "Reverse Calculator", ArrowLeftRight)}
            {navLink("/history", "Saved Quotes", History)}

            {/* Settings — all roles */}
            {navLink("/settings", "Settings", Settings)}

            {/* ServiceTitan section — user or admin only */}
            {isUserOrAdmin && (
              <div className="pt-2">
                <button
                  onClick={() => setStExpanded(!stExpanded)}
                  className={clsx(
                    "w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer font-medium",
                    isStActive
                      ? "bg-primary/10 text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                  data-testid="button-st-section"
                >
                  <div className="flex items-center gap-3">
                    <Upload size={20} className={isStActive ? "stroke-[2.5px]" : "stroke-2"} />
                    ServiceTitan
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
                          <div
                            className={clsx(
                              "flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 cursor-pointer text-sm",
                              isActive
                                ? "bg-primary/10 text-primary font-medium"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted"
                            )}
                            onClick={close}
                          >
                            <item.icon size={16} />
                            {item.label}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Reporting section — admin or manager */}
            {isReporting && (
              <div className="pt-2">
                <button
                  onClick={() => setReportingExpanded(!reportingExpanded)}
                  className={clsx(
                    "w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer font-medium",
                    location.startsWith("/reporting")
                      ? "bg-primary/10 text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                  data-testid="button-reporting-section"
                >
                  <div className="flex items-center gap-3">
                    <BarChart2 size={20} className={location.startsWith("/reporting") ? "stroke-[2.5px]" : "stroke-2"} />
                    Reporting
                  </div>
                  <ChevronDown
                    size={16}
                    className={clsx(
                      "transition-transform duration-200",
                      reportingExpanded ? "rotate-180" : ""
                    )}
                  />
                </button>

                {reportingExpanded && (
                  <div className="ml-4 mt-1 space-y-1 border-l-2 border-border pl-4">
                    <Link href="/reporting/dashboard">
                      <div
                        className={clsx(
                          "flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 cursor-pointer text-sm",
                          location === "/reporting/dashboard"
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        )}
                        onClick={close}
                        data-testid="link-reporting-dashboard"
                      >
                        <BarChart2 size={16} />
                        Dashboard
                      </div>
                    </Link>
                    <Link href="/reporting/activity">
                      <div
                        className={clsx(
                          "flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 cursor-pointer text-sm",
                          location === "/reporting/activity"
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        )}
                        onClick={close}
                        data-testid="link-reporting-activity"
                      >
                        <ScrollText size={16} />
                        Activity Log
                      </div>
                    </Link>
                  </div>
                )}
              </div>
            )}

            {/* Admin section */}
            {isAdmin && (
              <div className="pt-2">
                <button
                  onClick={() => setAdminExpanded(!adminExpanded)}
                  className={clsx(
                    "w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer font-medium",
                    location.startsWith("/admin")
                      ? "bg-primary/10 text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                  data-testid="button-admin-section"
                >
                  <div className="flex items-center gap-3">
                    <Shield size={20} className={location.startsWith("/admin") ? "stroke-[2.5px]" : "stroke-2"} />
                    Admin
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
                    <Link href="/admin/users">
                      <div
                        className={clsx(
                          "flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 cursor-pointer text-sm",
                          location === "/admin/users"
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        )}
                        onClick={close}
                        data-testid="link-admin-users"
                      >
                        <Users size={16} />
                        Manage Users
                      </div>
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* User identity + sign-out */}
          {user && (
            <div className="pt-4 border-t border-border mt-4 space-y-3">
              <div className="flex items-center gap-3 px-2">
                <Avatar className="w-8 h-8 shrink-0">
                  <AvatarImage src={user.avatarUrl ?? undefined} alt={user.name} />
                  <AvatarFallback className="text-xs">{getInitials(user.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate" data-testid="text-user-name">{user.name}</p>
                  <p className="text-xs text-muted-foreground capitalize" data-testid="text-user-role">{user.role}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
                onClick={handleSignOut}
                data-testid="button-sign-out"
              >
                <LogOut size={16} />
                Sign Out
              </Button>
            </div>
          )}
        </div>
      </nav>
    </>
  );
}
