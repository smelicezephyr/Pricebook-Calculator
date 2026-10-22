import { useState } from "react";
import { ArrowRight, LoaderCircle, ShieldCheck } from "lucide-react";
import { FaGoogle } from "react-icons/fa";
import horizontalLogo from "@assets/Logo_-_Horizontal_1772750848213.png";
import { useAuth } from "@/contexts/AuthContext";

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: "Google sign-in couldn't be completed. Please try again.",
  oauth_unavailable: "Google sign-in is temporarily unavailable. Please try again later.",
};

export default function Login({ authCheckFailed = false }: { authCheckFailed?: boolean }) {
  const [isRedirecting, setIsRedirecting] = useState(false);
  const { sessionExpired } = useAuth();
  const errorCode = new URLSearchParams(window.location.search).get("error");
  const errorMessage = authCheckFailed
    ? "We couldn't check your sign-in session. Check your connection and try again."
    : errorCode
      ? ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.auth_failed
      : null;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 px-4 py-10 sm:px-6">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-36 -top-40 h-[28rem] w-[28rem] rounded-full bg-blue-100/70 blur-3xl" />
        <div className="absolute -bottom-48 -left-40 h-[30rem] w-[30rem] rounded-full bg-indigo-100/60 blur-3xl" />
      </div>

      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5 lg:min-h-[560px] lg:grid-cols-[1.08fr_0.92fr]">
        <section className="flex flex-col justify-between bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-8 text-white sm:p-12 lg:p-14">
          <div>
            <img src={horizontalLogo} alt="Pricebook Calc" className="h-12 w-auto max-w-full rounded-sm bg-white p-1 object-contain object-left" />
          </div>

          <div className="my-12 max-w-md">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-blue-100">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Secure sign-in
            </div>
            <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              Welcome to Pricebook Calc
            </h1>
            <p className="mt-4 max-w-sm text-sm leading-6 text-slate-300 sm:text-base">
              Build consistent estimates and manage your service pricing with confidence.
            </p>
          </div>

          <p className="text-xs text-slate-400">
            Pricing tools for service businesses
          </p>
        </section>

        <section className="flex items-center justify-center p-6 sm:p-10 lg:p-14">
          <div className="w-full max-w-sm">
            <div className="mb-8">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">Your workspace</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                Sign in to continue
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Use your Google account to securely access your pricing workspace.
              </p>
            </div>

            {errorMessage && (
              <div
                role="alert"
                className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-800"
              >
                {errorMessage}
              </div>
            )}
            {!errorMessage && sessionExpired && (
              <div
                role="status"
                className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-5 text-amber-900"
              >
                Your session expired. Sign in again to continue.
              </div>
            )}

            <a
              href="/auth/google"
              onClick={(event) => {
                if (isRedirecting) {
                  event.preventDefault();
                  return;
                }
                setIsRedirecting(true);
              }}
              aria-disabled={isRedirecting}
              className={`flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border px-5 py-3 text-sm font-semibold shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
                isRedirecting
                  ? "cursor-wait border-slate-300 bg-slate-100 text-slate-500"
                  : "border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50"
              }`}
              data-testid="button-google-signin"
            >
              {isRedirecting ? (
                <>
                  <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
                  Connecting to Google…
                </>
              ) : (
                <>
                  <FaGoogle className="h-4 w-4 text-[#4285F4]" aria-hidden="true" />
                  Continue with Google
                  <ArrowRight className="ml-auto h-4 w-4 text-slate-400" aria-hidden="true" />
                </>
              )}
            </a>

            <p className="mt-4 text-center text-xs leading-5 text-slate-500">
              Sign in securely with any Google account.
            </p>

            <div className="mt-8 border-t border-slate-200 pt-6">
              <p className="text-center text-xs leading-5 text-slate-500">
                New here? Your account will be created when you sign in. An administrator can then assign the appropriate access.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
