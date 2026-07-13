import { useEffect, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";

export function usePrefetchTechRates(userId: number | undefined) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (!userId || firedRef.current) return;
    firedRef.current = true;
    apiRequest("POST", "/api/servicetitan/prefetch-all-tech-rates").catch(() => {});
  }, [userId]);
}
