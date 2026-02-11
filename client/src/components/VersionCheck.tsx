import { useState, useEffect, useRef } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function VersionCheck() {
  const [showBanner, setShowBanner] = useState(false);
  const initialBuildId = useRef<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;

    async function checkVersion() {
      try {
        const res = await fetch("/api/version");
        if (!res.ok) return;
        const data = await res.json();
        const buildId = data.buildId as string;

        if (initialBuildId.current === null) {
          initialBuildId.current = buildId;
        } else if (buildId !== initialBuildId.current) {
          setShowBanner(true);
        }
      } catch {
      }
    }

    checkVersion();
    timer = setInterval(checkVersion, 30000);

    return () => clearInterval(timer);
  }, []);

  if (!showBanner) return null;

  return (
    <div
      data-testid="banner-version-update"
      className="sticky top-0 z-[9999] bg-primary text-primary-foreground px-4 py-3 flex items-center justify-center gap-3 flex-wrap shadow-lg"
    >
      <RefreshCw className="h-4 w-4 animate-spin" />
      <span className="text-sm font-medium">
        A new version of PricebookCalc is available.
      </span>
      <Button
        data-testid="button-refresh-page"
        size="sm"
        variant="secondary"
        onClick={() => window.location.reload()}
      >
        Refresh Now
      </Button>
    </div>
  );
}
