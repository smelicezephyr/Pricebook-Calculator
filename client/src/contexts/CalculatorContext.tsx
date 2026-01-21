import { createContext, useContext, useState, ReactNode } from "react";

interface CalculatorState {
  materials: string;
  equipment: string;
  laborHours: string;
  laborPercent: string;
  targetMe: string;
  discount: string;
  discountMode: "dollar" | "percent";
  subcontractor: string;
  crane: string;
  permit: string;
  roundUp: boolean;
}

interface CalculatorContextType {
  state: CalculatorState;
  setState: (state: Partial<CalculatorState>) => void;
  resetState: (defaults: { targetMe: string; laborPercent: string }) => void;
}

const defaultState: CalculatorState = {
  materials: "",
  equipment: "",
  laborHours: "",
  laborPercent: "",
  targetMe: "23.0",
  discount: "",
  discountMode: "dollar",
  subcontractor: "",
  crane: "",
  permit: "",
  roundUp: false,
};

const CalculatorContext = createContext<CalculatorContextType | null>(null);

export function CalculatorProvider({ children }: { children: ReactNode }) {
  const [state, setStateInternal] = useState<CalculatorState>(defaultState);

  const setState = (newState: Partial<CalculatorState>) => {
    setStateInternal(prev => ({ ...prev, ...newState }));
  };

  const resetState = (defaults: { targetMe: string; laborPercent: string }) => {
    setStateInternal({
      ...defaultState,
      targetMe: defaults.targetMe,
      laborPercent: defaults.laborPercent,
    });
  };

  return (
    <CalculatorContext.Provider value={{ state, setState, resetState }}>
      {children}
    </CalculatorContext.Provider>
  );
}

export function useCalculatorState() {
  const context = useContext(CalculatorContext);
  if (!context) {
    throw new Error("useCalculatorState must be used within a CalculatorProvider");
  }
  return context;
}
