import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Navigation } from "@/components/Navigation";
import { CalculatorProvider } from "@/contexts/CalculatorContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { VersionCheck } from "@/components/VersionCheck";
import { Loader2 } from "lucide-react";
import NotFound from "@/pages/not-found";
import Calculator from "@/pages/Calculator";
import RepairCalculator from "@/pages/RepairCalculator";
import ReverseCalculator from "@/pages/ReverseCalculator";
import Settings from "@/pages/Settings";
import History from "@/pages/History";
import Tenants from "@/pages/Tenants";
import Locations from "@/pages/Locations";
import PushToServiceTitan from "@/pages/PushToServiceTitan";
import PushHistory from "@/pages/PushHistory";
import AdminUsers from "@/pages/AdminUsers";
import Login from "@/pages/Login";

function AppRouter() {
  const { isAdmin, isUserOrAdmin } = useAuth();

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-background text-foreground font-body">
      <Navigation />
      <main className="flex-1 w-full p-4 md:p-8 lg:p-12 overflow-y-auto h-screen">
        <Switch>
          <Route path="/" component={Calculator} />
          <Route path="/reverse" component={ReverseCalculator} />
          <Route path="/repair" component={RepairCalculator} />
          <Route path="/history" component={History} />

          {/* ServiceTitan — user or admin only */}
          <Route path="/push">
            {isUserOrAdmin ? <PushToServiceTitan /> : <NotFound />}
          </Route>
          <Route path="/push-history">
            {isUserOrAdmin ? <PushHistory /> : <NotFound />}
          </Route>

          {/* Admin-only pages */}
          <Route path="/tenants">
            {isAdmin ? <Tenants /> : <NotFound />}
          </Route>
          <Route path="/locations">
            {isAdmin ? <Locations /> : <NotFound />}
          </Route>
          <Route path="/settings">
            {isAdmin ? <Settings /> : <NotFound />}
          </Route>
          <Route path="/admin/users">
            {isAdmin ? <AdminUsers /> : <NotFound />}
          </Route>

          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function Router() {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <Switch>
        <Route path="/login" component={Login} />
        <Route>
          <Redirect to="/login" />
        </Route>
      </Switch>
    );
  }

  return (
    <Switch>
      <Route path="/login">
        <Redirect to="/" />
      </Route>
      <Route component={AppRouter} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <CalculatorProvider>
            <VersionCheck />
            <Toaster />
            <Router />
          </CalculatorProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
