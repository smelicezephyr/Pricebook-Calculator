import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { storage } from "./storage";
import type { User } from "@shared/schema";

declare global {
  namespace Express {
    interface User {
      id: number;
      googleId: string;
      email: string;
      name: string;
      avatarUrl: string | null;
      role: "everyone" | "user" | "admin";
      pushPermission: "both" | "reprice_only" | "add_new_only";
      emailNotifications: boolean;
      createdAt: Date | null;
    }
  }
}

export function configurePassport() {
  passport.serializeUser((user: Express.User, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUserById(id);
      done(null, user ?? false);
    } catch (err) {
      done(err);
    }
  });

  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientID || !clientSecret) {
    console.warn("[Auth] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set — Google OAuth disabled");
    return;
  }

  // Build callback URL from Replit environment
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  const callbackURL = domain
    ? `https://${domain}/auth/google/callback`
    : `http://localhost:${process.env.PORT || 5000}/auth/google/callback`;

  console.log(`[Auth] Google OAuth callback URL: ${callbackURL}`);

  passport.use(
    new GoogleStrategy(
      {
        clientID,
        clientSecret,
        callbackURL,
        proxy: true,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value ?? "";
          const avatarUrl = profile.photos?.[0]?.value ?? undefined;
          const user = await storage.upsertUser({
            googleId: profile.id,
            email,
            name: profile.displayName,
            avatarUrl,
          });
          // Fire-and-forget login event — never block auth on this
          storage.logLoginEvent(user.id, user.email, user.name).catch(err =>
            console.error("[Auth] Failed to log login event:", err)
          );
          done(null, user);
        } catch (err) {
          done(err as Error);
        }
      }
    )
  );
}
