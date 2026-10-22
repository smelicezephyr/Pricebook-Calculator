import { useEffect, useRef, useState, useCallback } from "react";
import { clearAuthSessionMarker, useAuth } from "@/contexts/AuthContext";
import { queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const TIMEOUT_MS = 60 * 60 * 1000;       // 60 minutes → auto-logout
const WARNING_MS = 55 * 60 * 1000;       // 55 minutes → show warning
const WARNING_DURATION_S = 5 * 60;       // 5-minute countdown in the dialog

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"] as const;

export function InactivityTimeout() {
  const { isAuthenticated } = useAuth();
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(WARNING_DURATION_S);

  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearAllTimers = useCallback(() => {
    if (warningTimerRef.current)  clearTimeout(warningTimerRef.current);
    if (logoutTimerRef.current)   clearTimeout(logoutTimerRef.current);
    if (countdownRef.current)     clearInterval(countdownRef.current);
  }, []);

  const doLogout = useCallback(async () => {
    clearAllTimers();
    setShowWarning(false);
    clearAuthSessionMarker();
    try {
      await fetch("/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      // best-effort
    }
    queryClient.clear();
    window.location.href = "/login";
  }, [clearAllTimers]);

  const startCountdown = useCallback(() => {
    setSecondsLeft(WARNING_DURATION_S);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1_000);
  }, []);

  const resetTimers = useCallback(() => {
    clearAllTimers();
    setShowWarning(false);

    warningTimerRef.current = setTimeout(() => {
      setShowWarning(true);
      startCountdown();
      logoutTimerRef.current = setTimeout(doLogout, WARNING_DURATION_S * 1_000);
    }, WARNING_MS);
  }, [clearAllTimers, startCountdown, doLogout]);

  const handleStaySignedIn = useCallback(() => {
    resetTimers();
  }, [resetTimers]);

  useEffect(() => {
    if (!isAuthenticated) return;

    resetTimers();

    const onActivity = () => {
      if (!showWarning) resetTimers();
    };

    ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, onActivity, { passive: true }));
    return () => {
      clearAllTimers();
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, onActivity));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  if (!isAuthenticated || !showWarning) return null;

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const countdown = `${mins}:${String(secs).padStart(2, "0")}`;

  return (
    <Dialog open={showWarning} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={e => e.preventDefault()}
        data-testid="dialog-inactivity-warning"
      >
        <DialogHeader>
          <DialogTitle>Are you still there?</DialogTitle>
          <DialogDescription>
            You've been inactive for 55 minutes. For your security, you'll be automatically
            signed out in{" "}
            <span className="font-semibold tabular-nums text-foreground" data-testid="text-countdown">
              {countdown}
            </span>{" "}
            unless you continue.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={doLogout}
            data-testid="button-signout-now"
          >
            Sign out now
          </Button>
          <Button
            onClick={handleStaySignedIn}
            data-testid="button-stay-signed-in"
          >
            Stay signed in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
