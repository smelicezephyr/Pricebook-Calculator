import { createContext, useContext, useState, ReactNode } from "react";

interface CalculatorState {
  materials: string;
  equipment: string;
  salesTaxPercent: string;
  laborMode: "hours" | "percent";
  laborHours: string;
  numTechs: string;
  laborPercent: string;
  targetMe: string;
  discount: string;
  discountMode: "dollar" | "percent";
  subcontractor: string;
  crane: string;
  permit: string;
  roundUp: boolean;
  oemRebate: string;
  utilityRebate: string;
}

interface RepairCalculatorState {
  partsCost: string;
  materialMarkup: string;
  laborRate: string;
  laborHours: string;
  numTechs: string;
  burdenPercent: string;
  salesTaxPercent: string;
  commissionPercent: string;
  financingFeePercent: string;
  highestTechRate: string;
  laborMode: "dollars" | "percent";
}

interface CalculatorContextType {
  state: CalculatorState;
  setState: (state: Partial<CalculatorState>) => void;
  resetState: (defaults: { targetMe: string; salesTaxPercent: string; laborPercent: string; laborMode: "hours" | "percent" }) => void;
  repairState: RepairCalculatorState;
  setRepairState: (state: Partial<RepairCalculatorState>) => void;
}

const defaultState: CalculatorState = {
  materials: "",
  equipment: "",
  salesTaxPercent: "6.35",
  laborMode: "percent",
  laborHours: "",
  numTechs: "1",
  laborPercent: "",
  targetMe: "23.0",
  discount: "",
  discountMode: "dollar",
  subcontractor: "",
  crane: "",
  permit: "",
  roundUp: false,
  oemRebate: "",
  utilityRebate: "",
};

const defaultRepairState: RepairCalculatorState = {
  partsCost: "",
  materialMarkup: "200",
  laborRate: "175.00",
  laborHours: "",
  numTechs: "1",
  burdenPercent: "20.00",
  salesTaxPercent: "6.35",
  commissionPercent: "10.00",
  financingFeePercent: "4.00",
  highestTechRate: "",
  laborMode: "dollars",
};

const CalculatorContext = createContext<CalculatorContextType | null>(null);

export function CalculatorProvider({ children }: { children: ReactNode }) {
  const [state, setStateInternal] = useState<CalculatorState>(defaultState);
  const [repairState, setRepairStateInternal] = useState<RepairCalculatorState>(defaultRepairState);

  const setState = (newState: Partial<CalculatorState>) => {
    setStateInternal(prev => ({ ...prev, ...newState }));
  };

  const resetState = (defaults: { targetMe: string; salesTaxPercent: string; laborPercent: string; laborMode: "hours" | "percent" }) => {
    setStateInternal({
      ...defaultState,
      targetMe: defaults.targetMe,
      salesTaxPercent: defaults.salesTaxPercent,
      laborPercent: defaults.laborPercent,
      laborMode: defaults.laborMode,
    });
  };

  const setRepairState = (newState: Partial<RepairCalculatorState>) => {
    setRepairStateInternal(prev => ({ ...prev, ...newState }));
  };

  return (
    <CalculatorContext.Provider value={{ state, setState, resetState, repairState, setRepairState }}>
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
