import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Navigation } from "@/components/Navigation";
import { CalculatorProvider } from "@/contexts/CalculatorContext";
import { ServiceTitanAuthProvider } from "@/contexts/ServiceTitanAuthContext";
import { PasswordGate } from "@/components/PasswordGate";
import NotFound from "@/pages/not-found";
import Calculator from "@/pages/Calculator";
import Settings from "@/pages/Settings";
import History from "@/pages/History";
import Tenants from "@/pages/Tenants";
import PushToServiceTitan from "@/pages/PushToServiceTitan";

function ProtectedPush() {
  return (
    <PasswordGate>
      <PushToServiceTitan />
    </PasswordGate>
  );
}

function ProtectedTenants() {
  return (
    <PasswordGate>
      <Tenants />
    </PasswordGate>
  );
}

function Router() {
  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-background text-foreground font-body">
      <Navigation />
      
      <main className="flex-1 w-full p-4 md:p-8 lg:p-12 overflow-y-auto h-screen">
        <Switch>
          <Route path="/" component={Calculator} />
          <Route path="/push" component={ProtectedPush} />
          <Route path="/history" component={History} />
          <Route path="/tenants" component={ProtectedTenants} />
          <Route path="/settings" component={Settings} />
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ServiceTitanAuthProvider>
          <CalculatorProvider>
            <Toaster />
            <Router />
          </CalculatorProvider>
        </ServiceTitanAuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
