import horizontalLogo from "@assets/Logo_-_Horizontal_1772750848213.png";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FaGoogle } from "react-icons/fa";

export default function Login() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex justify-center">
          <img src={horizontalLogo} alt="PricebookCalc" className="h-14 w-auto" />
        </div>

        <Card>
          <CardContent className="pt-8 pb-8 px-8 space-y-6 text-center">
            <div className="space-y-1">
              <h1 className="text-xl font-semibold text-foreground">Sign in to PricebookCalc</h1>
              <p className="text-sm text-muted-foreground">
                Use your Google account to access the app.
              </p>
            </div>

            <a href="/auth/google" className="block">
              <Button
                className="w-full gap-2 text-sm"
                size="lg"
                data-testid="button-google-signin"
              >
                <FaGoogle className="w-4 h-4" />
                Sign in with Google
              </Button>
            </a>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          After signing in, an admin will need to grant you access to ServiceTitan features.
        </p>
      </div>
    </div>
  );
}
