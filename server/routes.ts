import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import passport from "passport";
import { storage } from "./storage";
import { pool } from "./db";
import { api } from "@shared/routes";
import { z } from "zod";
import { ServiceTitanAPI } from "./servicetitan";
import { pushProgressEmitter, emitProgress } from "./pushProgress";
import { pushQueue, withRetry, MAX_CONCURRENT_PUSHES } from "./pushQueue";
import { processPush, processRepairPush, pendingPushExtras } from "./pushProcessor";
import type { PushHistory } from "@shared/schema";
import { sendPushCompleteNotification } from "./email";
import { getCachedTechRate, setCachedTechRate } from "./techRateCache";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Cleanup stale push history records on startup
  try {
    const cleanedUp = await storage.cleanupStalePushes();
    if (cleanedUp > 0) {
      console.log(`[Startup] Cleaned up ${cleanedUp} stale push history records (in_progress/pending marked as failed/cancelled)`);
    }
  } catch (err) {
    console.error("[Startup] Failed to cleanup stale pushes:", err);
  }
  
  const BUILD_ID = Date.now().toString();

  app.get("/api/version", (_req, res) => {
    res.json({ buildId: BUILD_ID });
  });

  app.get("/api/config/smtp-status", (_req, res) => {
    res.json({
      configured: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    });
  });

  // Health check endpoint for deployment
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // ── Auth Middleware ────────────────────────────────────────────────────────

  function requireAuth(req: Request, res: Response, next: NextFunction) {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Not authenticated" });
    next();
  }

  function requireAdmin(req: Request, res: Response, next: NextFunction) {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Not authenticated" });
    if (req.user!.role !== "admin") return res.status(403).json({ message: "Admin access required" });
    next();
  }

  function requireUserOrAdmin(req: Request, res: Response, next: NextFunction) {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Not authenticated" });
    const role = req.user!.role;
    if (role === "everyone") return res.status(403).json({ message: "Access not granted. Ask an admin to assign you to a tenant." });
    next();
  }

  // Reporting: admins and managers can view Dashboard / Activity Log / Team
  function requireReporting(req: Request, res: Response, next: NextFunction) {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Not authenticated" });
    const role = req.user!.role;
    if (role !== "admin" && role !== "manager") return res.status(403).json({ message: "Reporting access required" });
    next();
  }

  async function canAccessTenant(req: Request, tenantId: number): Promise<boolean> {
    const role = req.user!.role;
    if (role === "admin") return true;
    if (role !== "user" && role !== "manager") return false;
    const allowedIds = await storage.getUserTenantIds(req.user!.id);
    return allowedIds.includes(tenantId);
  }

  // ── Google OAuth ────────────────────────────────────────────────────────────

  const googleOAuthEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

  app.get("/auth/google", (req, res, next) => {
    if (!googleOAuthEnabled) {
      return res.status(503).json({ message: "Google OAuth is not configured on this server" });
    }
    passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
  });

  app.get(
    "/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/login?error=auth_failed" }),
    (_req, res) => { res.redirect("/"); }
  );

  app.post("/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) return res.status(500).json({ message: "Logout failed" });
      res.json({ success: true });
    });
  });

  // Current user
  app.get("/api/auth/me", (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Not authenticated" });
    res.json(req.user);
  });

  // ── Admin: User management ──────────────────────────────────────────────────

  app.get("/api/admin/users", requireAdmin, async (_req, res) => {
    const allUsers = await storage.listUsers();
    res.json(allUsers);
  });

  app.patch("/api/admin/users/:id/role", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid user ID" });
    const { role } = req.body;
    if (!["everyone", "user", "manager", "admin"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }
    const validRole = role as "everyone" | "user" | "manager" | "admin";
    const updated = await storage.updateUserRole(id, validRole);
    res.json(updated);
  });

  app.patch("/api/admin/users/:id/push-permission", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid user ID" });
    const { pushPermission } = req.body;
    if (!["both", "reprice_only", "add_new_only"].includes(pushPermission)) {
      return res.status(400).json({ message: "Invalid push permission" });
    }
    const validPermission = pushPermission as "both" | "reprice_only" | "add_new_only";
    const updated = await storage.updateUserPushPermission(id, validPermission);
    res.json(updated);
  });

  app.get("/api/admin/online-users", requireAdmin, async (_req, res) => {
    const result = await pool.query<{ user_id: number }>(`
      SELECT DISTINCT (sess->'passport'->>'user')::int AS user_id
      FROM session
      WHERE expire > NOW()
        AND sess->>'passport' IS NOT NULL
    `);
    res.json(result.rows.map(r => r.user_id));
  });

  app.get("/api/admin/users/:id/tenants", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid user ID" });
    const tenantIds = await storage.getUserTenantIds(id);
    res.json(tenantIds);
  });

  app.put("/api/admin/users/:id/tenants", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid user ID" });
    const { tenantIds } = req.body;
    if (!Array.isArray(tenantIds) || !tenantIds.every((t: any) => typeof t === "number")) {
      return res.status(400).json({ message: "tenantIds must be an array of numbers" });
    }
    await storage.setUserTenantAccess(id, tenantIds);
    res.json({ success: true });
  });

  app.get("/api/admin/dashboard", requireReporting, async (req, res) => {
    try {
      const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
      const requestedTenantId = req.query.tenantId ? Number(req.query.tenantId) : undefined;

      // Managers are restricted to tenants they have access to
      let tenantFilterId: number | undefined = undefined;
      if (req.user!.role === "manager") {
        const allowedIds = await storage.getUserTenantIds(req.user!.id);
        if (requestedTenantId !== undefined) {
          if (!allowedIds.includes(requestedTenantId)) {
            return res.status(403).json({ message: "You don't have access to this tenant" });
          }
          tenantFilterId = requestedTenantId;
        } else if (allowedIds.length > 0) {
          tenantFilterId = allowedIds[0];
        } else {
          tenantFilterId = -1; // no access to any tenant
        }
      } else if (requestedTenantId !== undefined) {
        tenantFilterId = requestedTenantId;
      }

      // Build date filter clauses
      const dateParams: string[] = [];
      const dateConditions: string[] = ["status NOT IN ('pending','in_progress')"];
      if (startDate) { dateConditions.push(`created_at >= $${dateParams.push(startDate)}`); }
      if (endDate)   { dateConditions.push(`created_at <= ($${dateParams.push(endDate)}::date + INTERVAL '1 day')`); }
      if (tenantFilterId !== undefined) { dateConditions.push(`tenant_id = $${dateParams.push(String(tenantFilterId))}`); }
      const dateWhere = dateConditions.join(" AND ");

      // For tenant join, build separate param sets
      const tenantParams: string[] = [];
      const tenantDateConds: string[] = ["ph.status NOT IN ('pending','in_progress')"];
      if (startDate) { tenantDateConds.push(`ph.created_at >= $${tenantParams.push(startDate)}`); }
      if (endDate)   { tenantDateConds.push(`ph.created_at <= ($${tenantParams.push(endDate)}::date + INTERVAL '1 day')`); }
      const tenantDateWhere = tenantDateConds.join(" AND ");
      // Quote date conditions for the tenant JOIN (appended to same tenantParams)
      const quoteTenantDateConds: string[] = [];
      if (startDate) { quoteTenantDateConds.push(`q.created_at >= $${tenantParams.push(startDate)}`); }
      if (endDate)   { quoteTenantDateConds.push(`q.created_at <= ($${tenantParams.push(endDate)}::date + INTERVAL '1 day')`); }
      const quoteTenantDateWhere = quoteTenantDateConds.length ? `AND ${quoteTenantDateConds.join(" AND ")}` : "";
      const tenantRowFilter = tenantFilterId !== undefined ? `WHERE t.id = $${tenantParams.push(String(tenantFilterId))}` : "";

      // Monthly chart: use the date range if provided, else last 6 months
      const monthlyParams: string[] = [];
      const monthlyStart = startDate || null;
      const monthlyEnd   = endDate   || null;
      const monthlyConds: string[] = ["status NOT IN ('pending','in_progress')"];
      if (monthlyStart) { monthlyConds.push(`created_at >= $${monthlyParams.push(monthlyStart)}`); }
      else               { monthlyConds.push(`created_at >= NOW() - INTERVAL '6 months'`); }
      if (monthlyEnd)   { monthlyConds.push(`created_at <= ($${monthlyParams.push(monthlyEnd)}::date + INTERVAL '1 day')`); }
      if (tenantFilterId !== undefined) { monthlyConds.push(`tenant_id = $${monthlyParams.push(String(tenantFilterId))}`); }
      const monthlyWhere = monthlyConds.join(" AND ");

      // Monthly quotes (separate params)
      const monthlyQuoteParams: string[] = [];
      const monthlyQuoteConds: string[] = [];
      if (monthlyStart) { monthlyQuoteConds.push(`created_at >= $${monthlyQuoteParams.push(monthlyStart)}`); }
      else               { monthlyQuoteConds.push(`created_at >= NOW() - INTERVAL '6 months'`); }
      if (monthlyEnd)   { monthlyQuoteConds.push(`created_at <= ($${monthlyQuoteParams.push(monthlyEnd)}::date + INTERVAL '1 day')`); }
      if (tenantFilterId !== undefined) { monthlyQuoteConds.push(`tenant_id = $${monthlyQuoteParams.push(String(tenantFilterId))}`); }
      const monthlyQuoteWhere = monthlyQuoteConds.join(" AND ");

      // Overall quote count params
      const quoteParams: string[] = [];
      const quoteConds: string[] = [];
      if (startDate) { quoteConds.push(`created_at >= $${quoteParams.push(startDate)}`); }
      if (endDate)   { quoteConds.push(`created_at <= ($${quoteParams.push(endDate)}::date + INTERVAL '1 day')`); }
      if (tenantFilterId !== undefined) { quoteConds.push(`tenant_id = $${quoteParams.push(String(tenantFilterId))}`); }
      const quoteWhere = quoteConds.length ? quoteConds.join(" AND ") : "TRUE";

      // Build login date conditions (login_events uses created_at), scoped to tenant's users when filtering
      const loginParams: string[] = [];
      const loginConds: string[] = [];
      if (startDate) { loginConds.push(`le.created_at >= $${loginParams.push(startDate)}`); }
      if (endDate)   { loginConds.push(`le.created_at <= ($${loginParams.push(endDate)}::date + INTERVAL '1 day')`); }
      if (tenantFilterId !== undefined) {
        loginConds.push(`le.user_id IN (SELECT user_id FROM user_tenant_access WHERE tenant_id = $${loginParams.push(String(tenantFilterId))})`);
      }
      const loginWhere = loginConds.length ? `WHERE ${loginConds.join(" AND ")}` : "";

      const [overallResult, tenantResult, monthlyResult, userResult, typeResult, loginCountResult, recentLoginsResult, quotesOverallResult, monthlyQuotesResult] = await Promise.all([
        pool.query(
          `SELECT
            COUNT(*) AS total_pushes,
            COUNT(*) FILTER (WHERE status = 'completed') AS completed,
            COUNT(*) FILTER (WHERE status = 'failed') AS failed,
            COALESCE(SUM(updated_count) FILTER (WHERE status IN ('completed','cancelled','reverted')), 0) AS total_updated,
            COUNT(DISTINCT tenant_id) AS active_tenants
          FROM push_history
          WHERE ${dateWhere}`,
          dateParams,
        ),
        pool.query(
          `SELECT
            t.id,
            t.name,
            COUNT(DISTINCT ph.id) AS total_pushes,
            COUNT(DISTINCT ph.id) FILTER (WHERE ph.status = 'completed') AS completed,
            COUNT(DISTINCT ph.id) FILTER (WHERE ph.status = 'failed') AS failed,
            COALESCE(SUM(ph.updated_count), 0) AS total_updated,
            MAX(ph.created_at) AS last_push,
            COUNT(DISTINCT q.id) AS total_quotes
          FROM tenants t
          LEFT JOIN push_history ph ON ph.tenant_id = t.id
            AND ${tenantDateWhere}
          LEFT JOIN quotes q ON q.tenant_id = t.id ${quoteTenantDateWhere}
          ${tenantRowFilter}
          GROUP BY t.id, t.name
          ORDER BY total_updated DESC`,
          tenantParams,
        ),
        pool.query(
          `SELECT
            TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YY') AS month,
            DATE_TRUNC('month', created_at) AS month_date,
            COUNT(*) AS pushes,
            COALESCE(SUM(updated_count), 0) AS updated
          FROM push_history
          WHERE ${monthlyWhere}
          GROUP BY DATE_TRUNC('month', created_at)
          ORDER BY month_date ASC`,
          monthlyParams,
        ),
        tenantFilterId !== undefined
          ? pool.query(
              `SELECT COUNT(DISTINCT u.id) AS active_users
               FROM users u
               JOIN user_tenant_access uta ON uta.user_id = u.id
               WHERE u.role != 'everyone' AND uta.tenant_id = $1`,
              [String(tenantFilterId)],
            )
          : pool.query(`SELECT COUNT(*) AS active_users FROM users WHERE role != 'everyone'`),
        pool.query(
          `SELECT COALESCE(push_type, 'update') AS push_type, COUNT(*) AS cnt
           FROM push_history WHERE ${dateWhere}
           GROUP BY COALESCE(push_type, 'update')`,
          dateParams,
        ),
        pool.query(
          `SELECT COUNT(*) AS login_count FROM login_events le ${loginWhere}`,
          loginParams,
        ),
        pool.query(
          `SELECT le.id, le.user_name AS name, le.user_email AS email,
                  COALESCE(u.role, 'everyone') AS role, le.created_at
           FROM login_events le
           LEFT JOIN users u ON u.id = le.user_id
           ${loginWhere}
           ORDER BY le.created_at DESC LIMIT 30`,
          loginParams,
        ),
        pool.query(
          `SELECT COUNT(*) AS total_quotes FROM quotes WHERE ${quoteWhere}`,
          quoteParams,
        ),
        pool.query(
          `SELECT
            TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YY') AS month,
            DATE_TRUNC('month', created_at) AS month_date,
            COUNT(*) AS quotes
          FROM quotes
          WHERE ${monthlyQuoteWhere}
          GROUP BY DATE_TRUNC('month', created_at)
          ORDER BY month_date ASC`,
          monthlyQuoteParams,
        ),
      ]);

      const o = overallResult.rows[0];
      const total = Number(o.completed) + Number(o.failed);

      const byType = { update: 0, newSystem: 0, newRepair: 0 };
      for (const row of typeResult.rows) {
        if (row.push_type === 'update')     byType.update     = Number(row.cnt);
        if (row.push_type === 'new_system') byType.newSystem  = Number(row.cnt);
        if (row.push_type === 'new_repair') byType.newRepair  = Number(row.cnt);
      }

      // Merge monthly push + quote data by month key
      const monthlyQuoteMap = new Map<string, number>();
      for (const r of monthlyQuotesResult.rows) {
        monthlyQuoteMap.set(r.month, Number(r.quotes));
      }
      // Also collect months that only have quotes (no pushes)
      const pushMonths = new Set(monthlyResult.rows.map((r: any) => r.month));
      const quoteOnlyRows = monthlyQuotesResult.rows.filter((r: any) => !pushMonths.has(r.month));

      const monthlyMerged = [
        ...monthlyResult.rows.map((r: any) => ({
          month: r.month,
          monthDate: r.month_date,
          pushes: Number(r.pushes),
          updated: Number(r.updated),
          quotes: monthlyQuoteMap.get(r.month) ?? 0,
        })),
        ...quoteOnlyRows.map((r: any) => ({
          month: r.month,
          monthDate: r.month_date,
          pushes: 0,
          updated: 0,
          quotes: Number(r.quotes),
        })),
      ].sort((a, b) => new Date(a.monthDate).getTime() - new Date(b.monthDate).getTime());

      res.json({
        totalPushes: Number(o.total_pushes),
        completedPushes: Number(o.completed),
        failedPushes: Number(o.failed),
        totalUpdated: Number(o.total_updated),
        successRate: total > 0 ? Math.round((Number(o.completed) / total) * 100) : null,
        activeTenants: Number(o.active_tenants),
        activeUsers: Number(userResult.rows[0].active_users),
        loginCount: Number(loginCountResult.rows[0].login_count),
        totalQuotes: Number(quotesOverallResult.rows[0].total_quotes),
        byType,
        recentLogins: recentLoginsResult.rows.map(r => ({
          id: Number(r.id),
          name: r.name,
          email: r.email,
          role: r.role,
          createdAt: r.created_at,
        })),
        byTenant: tenantResult.rows.map(r => ({
          id: Number(r.id),
          name: r.name,
          totalPushes: Number(r.total_pushes),
          completed: Number(r.completed),
          failed: Number(r.failed),
          totalUpdated: Number(r.total_updated),
          lastPush: r.last_push,
          totalQuotes: Number(r.total_quotes),
          successRate: (Number(r.completed) + Number(r.failed)) > 0
            ? Math.round((Number(r.completed) / (Number(r.completed) + Number(r.failed))) * 100)
            : null,
        })),
        monthly: monthlyMerged.map(r => ({
          month: r.month,
          pushes: r.pushes,
          updated: r.updated,
          quotes: r.quotes,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/history/logins", requireReporting, async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const events = await storage.listLoginEvents(limit);

    if (req.user!.role === "manager") {
      const tenantId = req.query.tenantId ? Number(req.query.tenantId) : undefined;
      const allowedIds = await storage.getUserTenantIds(req.user!.id);
      const targetTenantId = tenantId !== undefined ? tenantId : allowedIds[0];
      if (targetTenantId === undefined || !allowedIds.includes(targetTenantId)) {
        return res.json([]);
      }
      const teamUsers = await storage.getUsersByTenant(targetTenantId);
      const teamUserIds = new Set(teamUsers.map(u => u.id));
      return res.json(events.filter(e => e.userId !== null && teamUserIds.has(e.userId)));
    }

    res.json(events);
  });

  // ── Reporting: read-only team view + tenant-scoped quotes ──────────────────

  app.get("/api/reporting/team", requireReporting, async (req, res) => {
    try {
      const tenantId = req.query.tenantId ? Number(req.query.tenantId) : undefined;
      if (tenantId === undefined || isNaN(tenantId)) {
        return res.status(400).json({ message: "tenantId is required" });
      }
      if (!(await canAccessTenant(req, tenantId))) {
        return res.status(403).json({ message: "You don't have access to this tenant" });
      }
      const teamUsers = await storage.getUsersByTenant(tenantId);
      res.json(teamUsers.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        avatarUrl: u.avatarUrl,
        role: u.role,
        pushPermission: u.pushPermission,
      })));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/reporting/quotes", requireReporting, async (req, res) => {
    try {
      const tenantId = req.query.tenantId ? Number(req.query.tenantId) : undefined;
      if (tenantId === undefined || isNaN(tenantId)) {
        return res.status(400).json({ message: "tenantId is required" });
      }
      if (!(await canAccessTenant(req, tenantId))) {
        return res.status(403).json({ message: "You don't have access to this tenant" });
      }
      const teamUsers = await storage.getUsersByTenant(tenantId);
      const quotes = await storage.getQuotesByUserIds(teamUsers.map(u => u.id));
      const userMap = new Map(teamUsers.map(u => [u.id, u.name]));
      res.json(quotes.map(q => ({ ...q, userName: userMap.get(q.userId) ?? "Unknown" })));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/users/me/email-notifications", requireAdmin, async (req, res) => {
    try {
      const { enabled } = req.body;
      await storage.setEmailNotifications(req.user!.id, !!enabled);
      res.json({ success: true, emailNotifications: !!enabled });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid user ID" });
    if (req.user!.id === id) return res.status(400).json({ message: "You cannot delete your own account" });
    await storage.deleteUser(id);
    res.json({ success: true });
  });

  app.delete("/api/admin/clear-history", requireAdmin, async (_req, res) => {
    try {
      await storage.clearAllQuotes();
      res.json({ success: true });
    } catch {
      res.status(500).json({ success: false, error: "Failed to clear history" });
    }
  });

  // Backfill tenant_id on quotes that were saved without one.
  // Two-pass strategy:
  //   1. Single-tenant access: if the user is assigned to exactly one tenant, use it.
  //   2. Domain matching: normalize the email domain against tenant names using the
  //      same logic as autoGrantTenantByDomain (no guessing on multi-match).
  // Safe to run multiple times — only touches rows where tenant_id IS NULL.
  app.post("/api/admin/backfill-quote-tenants", requireAdmin, async (_req, res) => {
    try {
      // Fetch all null-tenant quotes with their author's email
      const { rows: nullQuotes } = await pool.query<{ id: number; user_id: number; email: string }>(`
        SELECT q.id, q.user_id, u.email
        FROM quotes q
        JOIN users u ON u.id = q.user_id
        WHERE q.tenant_id IS NULL
      `);

      if (nullQuotes.length === 0) return res.json({ fixed: 0 });

      // Fetch all tenants and all user→tenant assignments
      const allTenants = await storage.getTenants();
      const { rows: accessRows } = await pool.query<{ user_id: number; tenant_id: number; cnt: string }>(`
        SELECT user_id, tenant_id, COUNT(*) OVER (PARTITION BY user_id)::text AS cnt
        FROM user_tenant_access
      `);

      // Build maps for fast lookup
      const singleTenantMap = new Map<number, number>(); // user_id → tenant_id (only when cnt=1)
      for (const row of accessRows) {
        if (row.cnt === "1") singleTenantMap.set(row.user_id, row.tenant_id);
      }

      // Domain-match helper — mirrors the updated autoGrantTenantByDomain logic.
      // Three-way match: substring contains OR shared prefix ≥6 chars.
      const commonPrefixLen = (a: string, b: string) => {
        let i = 0;
        while (i < a.length && i < b.length && a[i] === b[i]) i++;
        return i;
      };
      const domainMatchTenant = (email: string): number | null => {
        const domain = email.split("@")[1];
        if (!domain) return null;
        const domainRoot = domain.split(".")[0];
        const normalizedDomain = domainRoot.toLowerCase().replace(/[^a-z0-9]/g, "");
        const matches = allTenants.filter(t => {
          const normalizedName = t.name.toLowerCase().replace(/[^a-z0-9]/g, "");
          return (
            normalizedName.includes(normalizedDomain) ||
            normalizedDomain.includes(normalizedName) ||
            commonPrefixLen(normalizedDomain, normalizedName) >= 6
          );
        });
        return matches.length === 1 ? matches[0].id : null;
      };

      // Resolve a tenant for each null-tenant quote
      const updates: Array<{ id: number; tenantId: number }> = [];
      for (const q of nullQuotes) {
        const tenantId =
          singleTenantMap.get(q.user_id) ??   // pass 1: single-tenant access
          domainMatchTenant(q.email);           // pass 2: email domain match
        if (tenantId != null) updates.push({ id: q.id, tenantId });
      }

      if (updates.length === 0) return res.json({ fixed: 0 });

      // Batch-update using unnest
      const ids = updates.map(u => u.id);
      const tenantIds = updates.map(u => u.tenantId);
      await pool.query(
        `UPDATE quotes SET tenant_id = v.tid
         FROM unnest($1::int[], $2::int[]) AS v(qid, tid)
         WHERE quotes.id = v.qid`,
        [ids, tenantIds]
      );

      res.json({ fixed: updates.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // My accessible tenant IDs (used by frontend to filter dropdowns)
  app.get("/api/my/tenant-ids", requireUserOrAdmin, async (req, res) => {
    const user = req.user!;
    if (user.role === "admin") {
      const all = await storage.getTenants();
      return res.json(all.map((t: any) => t.id));
    }
    const ids = await storage.getUserTenantIds(user.id);
    res.json(ids);
  });

  // ── Settings Routes ─────────────────────────────────────────────────────────

  app.get(api.settings.get.path, requireAuth, async (req, res) => {
    const settings = await storage.getSettings(req.user!.id);
    res.json(settings);
  });

  app.put(api.settings.update.path, requireAuth, async (req, res) => {
    try {
      const input = api.settings.update.input.parse(req.body);
      const updated = await storage.updateSettings(req.user!.id, input);
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
    }
  });

  // ── Quotes Routes ──────────────────────────────────────────────────────────

  app.get(api.quotes.list.path, requireAuth, async (req, res) => {
    const quotes = await storage.getQuotes(req.user!.id, req.user!.role === "admin");
    res.json(quotes);
  });

  app.post(api.quotes.create.path, requireAuth, async (req, res) => {
    try {
      const input = api.quotes.create.input.parse(req.body);
      // If the frontend didn't send a tenantId (e.g. tenant selector wasn't visible),
      // auto-assign from the user's access when they have exactly one tenant.
      if (input.tenantId == null) {
        const allowedIds = await storage.getUserTenantIds(req.user!.id);
        if (allowedIds.length === 1) input.tenantId = allowedIds[0];
      }
      const quote = await storage.createQuote(input, req.user!.id);
      res.status(201).json(quote);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
    }
  });

  app.delete(api.quotes.delete.path, requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const result = await storage.deleteQuote(id, req.user!.id, req.user!.role === "admin");
    if (result.forbidden) return res.status(403).json({ message: "Not your quote" });
    res.status(204).send();
  });

  app.delete("/api/quotes", requireAuth, async (req, res) => {
    if (req.user!.role === "admin") {
      await storage.clearAllQuotes();
    } else {
      await storage.clearUserQuotes(req.user!.id);
    }
    res.status(204).send();
  });

  // Helper to sanitize tenant data (mask secrets)
  const sanitizeTenant = (tenant: any) => ({
    id: tenant.id,
    name: tenant.name,
    tenantId: tenant.tenantId,
    clientId: tenant.clientId.substring(0, 8) + "...",
    clientSecret: "••••••••",
    appKey: tenant.appKey.substring(0, 8) + "...",
    locationId: tenant.locationId,
    isActive: tenant.isActive,
    sortOrder: tenant.sortOrder,
    afterHoursMultiplier: tenant.afterHoursMultiplier ?? 1.5,
    createdAt: tenant.createdAt,
  });

  // Location Routes
  app.get("/api/locations", requireUserOrAdmin, async (_req, res) => {
    const allLocations = await storage.getLocations();
    res.json(allLocations);
  });

  app.post("/api/locations", requireAdmin, async (req, res) => {
    try {
      const { name, salesTaxPercent } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ message: "Location name is required" });
      }
      const taxVal = parseFloat(salesTaxPercent);
      if (isNaN(taxVal) || taxVal < 0 || taxVal > 100) {
        return res.status(400).json({ message: "Sales tax must be a number between 0 and 100" });
      }
      const location = await storage.createLocation({
        name: name.trim(),
        salesTaxPercent: String(taxVal),
      });
      res.status(201).json(location);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/locations/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    try {
      const { name, salesTaxPercent } = req.body;
      const updates: any = {};
      if (name !== undefined) updates.name = name.trim();
      if (salesTaxPercent !== undefined) {
        const taxVal = parseFloat(salesTaxPercent);
        if (isNaN(taxVal) || taxVal < 0 || taxVal > 100) {
          return res.status(400).json({ message: "Sales tax must be a number between 0 and 100" });
        }
        updates.salesTaxPercent = String(taxVal);
      }
      const location = await storage.updateLocation(id, updates);
      res.json(location);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/locations/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    try {
      await storage.deleteLocation(id);
      res.status(204).end();
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Tenant Routes
  // Uses requireAuth (not requireUserOrAdmin) so that `everyone` role users can
  // see their assigned tenants — this populates the tenant selector on calculators
  // and ensures saved quotes carry the correct tenant_id.
  app.get(api.tenants.list.path, requireAuth, async (req, res) => {
    const allTenants = await storage.getTenants();
    const user = req.user!;
    if (user.role === "admin") {
      return res.json(allTenants.map(sanitizeTenant));
    }
    // All non-admin roles: return only tenants the user is assigned to
    const allowedIds = await storage.getUserTenantIds(user.id);
    res.json(allTenants.filter(t => allowedIds.includes(t.id)).map(sanitizeTenant));
  });

  app.get(api.tenants.get.path, requireUserOrAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    if (!(await canAccessTenant(req, id))) {
      return res.status(403).json({ message: "You don't have access to this tenant" });
    }
    const tenant = await storage.getTenant(id);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    res.json(sanitizeTenant(tenant));
  });

  app.post(api.tenants.create.path, requireAdmin, async (req, res) => {
    try {
      const input = api.tenants.create.input.parse(req.body);
      const tenant = await storage.createTenant(input);
      res.status(201).json(tenant);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
    }
  });

  app.put(api.tenants.update.path, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    try {
      const input = api.tenants.update.input.parse(req.body);
      
      // If credentials are empty strings, remove them to preserve existing
      const updateData: Record<string, any> = { ...input };
      if (updateData.clientId === '') delete updateData.clientId;
      if (updateData.clientSecret === '') delete updateData.clientSecret;
      if (updateData.appKey === '') delete updateData.appKey;
      
      const tenant = await storage.updateTenant(id, updateData);
      if (!tenant) {
        return res.status(404).json({ message: "Tenant not found" });
      }
      res.json(tenant);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
    }
  });

  app.delete(api.tenants.delete.path, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    await storage.deleteTenant(id);
    res.status(204).send();
  });

  // Reorder tenants
  app.post("/api/tenants/reorder", requireAdmin, async (req, res) => {
    try {
      const { orderedIds } = req.body;
      if (!Array.isArray(orderedIds) || !orderedIds.every(id => typeof id === 'number')) {
        return res.status(400).json({ message: "orderedIds must be an array of numbers" });
      }
      
      // Validate that orderedIds matches all existing tenant IDs
      const existingTenants = await storage.getTenants();
      const existingIds = new Set(existingTenants.map(t => t.id));
      const submittedIds = new Set(orderedIds);
      
      if (orderedIds.length !== existingTenants.length) {
        return res.status(400).json({ message: "orderedIds must contain all tenant IDs" });
      }
      
      for (const id of orderedIds) {
        if (!existingIds.has(id)) {
          return res.status(400).json({ message: `Invalid tenant ID: ${id}` });
        }
      }
      
      if (submittedIds.size !== orderedIds.length) {
        return res.status(400).json({ message: "orderedIds contains duplicate IDs" });
      }
      
      await storage.reorderTenants(orderedIds);
      res.json({ success: true });
    } catch (err) {
      console.error("Reorder error:", err);
      res.status(500).json({ message: "Failed to reorder tenants" });
    }
  });

  // Get full tenant data (unmasked) for editing
  app.get("/api/tenants/:id/full", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const tenant = await storage.getTenant(id);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    // Return full unmasked data since this is in a password-protected section
    res.json(tenant);
  });

  // ServiceTitan API Routes
  app.post("/api/servicetitan/:tenantId/test", requireUserOrAdmin, async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (isNaN(tenantId)) {
      return res.status(400).json({ success: false, message: "Invalid tenant ID" });
    }
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ success: false, message: "Tenant not found" });
    }
    if (!(await canAccessTenant(req, tenantId))) {
      return res.status(403).json({ success: false, message: "You don't have access to this tenant" });
    }
    try {
      const stApi = new ServiceTitanAPI(tenant);
      await stApi.testConnection();
      // Also try to fetch categories to verify full API access
      const categories = await stApi.getCategories();
      res.json({ 
        success: true, 
        message: `Connected successfully! Found ${categories.length} categories.`
      });
    } catch (err: any) {
      res.json({ 
        success: false, 
        message: err.message || "Failed to connect to ServiceTitan"
      });
    }
  });

  // Background prefetch: warm the tech-rate cache for every tenant the user can access.
  // Returns 202 immediately — no data is sent back to the client.
  // This endpoint is intentionally opaque: callers only learn that the prefetch was accepted.
  app.post("/api/servicetitan/prefetch-all-tech-rates", requireUserOrAdmin, async (req, res) => {
    res.status(202).end();
    // Resolve the tenant list for this user
    const user = req.user!;
    let tenantIds: number[];
    try {
      if (user.role === "admin") {
        const all = await storage.getTenants();
        tenantIds = all.filter((t) => t.isActive).map((t) => t.id);
      } else {
        tenantIds = await storage.getUserTenantIds(user.id);
      }
    } catch {
      return;
    }
    // Fire background fetch for each tenant — no await, no error surface to client
    for (const id of tenantIds) {
      const cached = getCachedTechRate(id);
      if (cached) continue; // already warm
      storage.getTenant(id).then((tenant) => {
        if (!tenant) return;
        const api = new ServiceTitanAPI(tenant);
        api.getHighestTechnicianRate()
          .then(({ rate, technicianName, technicianCount }) => {
            setCachedTechRate(id, rate, technicianName, technicianCount);
          })
          .catch(() => {});
      }).catch(() => {});
    }
  });

  // Fetch the highest technician pay rate from ServiceTitan's Payroll API.
  // Serves from the in-memory cache when available (populated by prefetch or a prior call).
  app.get("/api/servicetitan/:tenantId/highest-tech-rate", requireUserOrAdmin, async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (isNaN(tenantId)) {
      return res.status(400).json({ message: "Invalid tenant ID" });
    }
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    if (!(await canAccessTenant(req, tenantId))) {
      return res.status(403).json({ message: "You don't have access to this tenant" });
    }
    // Serve from cache if available
    const cached = getCachedTechRate(tenantId);
    if (cached) {
      return res.json({ rate: cached.rate, technicianName: cached.technicianName, technicianCount: cached.technicianCount });
    }
    try {
      const api = new ServiceTitanAPI(tenant);
      const result = await api.getHighestTechnicianRate();
      setCachedTechRate(tenantId, result.rate, result.technicianName, result.technicianCount);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/servicetitan/:tenantId/categories", requireUserOrAdmin, async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (isNaN(tenantId)) {
      return res.status(400).json({ message: "Invalid tenant ID" });
    }
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    if (!(await canAccessTenant(req, tenantId))) {
      return res.status(403).json({ message: "You don't have access to this tenant" });
    }
    try {
      const api = new ServiceTitanAPI(tenant);
      const categories = await api.getCategories();
      res.json(categories.filter((c: any) => c.active !== false && (!c.categoryType || c.categoryType === "Services")));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/servicetitan/:tenantId/services", requireUserOrAdmin, async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
    if (isNaN(tenantId)) {
      return res.status(400).json({ message: "Invalid tenant ID" });
    }
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    if (!(await canAccessTenant(req, tenantId))) {
      return res.status(403).json({ message: "You don't have access to this tenant" });
    }
    try {
      const api = new ServiceTitanAPI(tenant);
      const services = await api.getServices(categoryId);
      res.json(services);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/servicetitan/:tenantId/services/:serviceId", requireUserOrAdmin, async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const serviceId = Number(req.params.serviceId);
    if (isNaN(tenantId) || isNaN(serviceId)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    if (!(await canAccessTenant(req, tenantId))) {
      return res.status(403).json({ message: "You don't have access to this tenant" });
    }
    try {
      const api = new ServiceTitanAPI(tenant);
      const updated = await api.updateService(serviceId, req.body);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/servicetitan/:tenantId/gl-accounts", requireUserOrAdmin, async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (isNaN(tenantId)) {
      return res.status(400).json({ message: "Invalid tenant ID" });
    }
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    if (!(await canAccessTenant(req, tenantId))) {
      return res.status(403).json({ message: "You don't have access to this tenant" });
    }
    try {
      const api = new ServiceTitanAPI(tenant);
      const accounts = await api.getGLAccounts();
      res.json(accounts);
    } catch (err: any) {
      console.error(`[GLAccounts] Error fetching GL accounts:`, err.message);
      res.status(500).json({ message: err.message });
    }
  });
  
  // Debug endpoint to get a single service with full details
  app.get("/api/servicetitan/:tenantId/services/:serviceId/debug", requireUserOrAdmin, async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const serviceId = Number(req.params.serviceId);
    if (isNaN(tenantId) || isNaN(serviceId)) {
      return res.status(400).json({ message: "Invalid tenant ID or service ID" });
    }
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    if (!(await canAccessTenant(req, tenantId))) {
      return res.status(403).json({ message: "You don't have access to this tenant" });
    }
    try {
      const api = new ServiceTitanAPI(tenant);
      const service = await api.getServiceById(serviceId);
      res.json(service);
    } catch (err: any) {
      console.error(`[ServiceDebug] Error:`, err.message);
      res.status(500).json({ message: err.message });
    }
  });

  const createServiceSchema = z.object({
    code: z.string().min(1, "Code is required").max(31, "Code must be 31 characters or less"),
    displayName: z.string().min(1, "Name is required"),
    description: z.string().optional(),
    warranty: z.object({ duration: z.number(), description: z.string() }).optional(),
    taxable: z.boolean().optional(),
    active: z.boolean().optional(),
    price: z.number().min(0, "Price must be non-negative").optional(),
    memberPrice: z.number().min(0).optional(),
    hours: z.number().min(0, "Hours must be non-negative").optional(),
    categories: z.array(z.number()).optional(),
    account: z.string().optional(), // Account is a string name like "Sales", not a numeric ID
    allowDiscountCodes: z.boolean().optional(),
    allowMembershipDiscounts: z.boolean().optional(),
  });

  app.post("/api/servicetitan/:tenantId/services", requireUserOrAdmin, async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (isNaN(tenantId)) {
      return res.status(400).json({ message: "Invalid tenant ID" });
    }
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    if (!(await canAccessTenant(req, tenantId))) {
      return res.status(403).json({ message: "You don't have access to this tenant" });
    }
    if (req.user?.role !== "admin" && req.user?.pushPermission === "reprice_only") {
      return res.status(403).json({ message: "You don't have permission to add new tasks" });
    }
    try {
      const validatedBody = createServiceSchema.parse(req.body);
      const api = new ServiceTitanAPI(tenant);
      const service = await api.createService(validatedBody);
      res.status(201).json(service);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      console.error(`[CreateService] Error creating service:`, err.message);
      res.status(500).json({ message: err.message });
    }
  });

  const uploadImageSchema = z.object({
    imageData: z.string().min(1, "Image data is required"),
    filename: z.string().min(1, "Filename is required"),
    mimeType: z.string().regex(/^image\//, "Must be an image MIME type"),
  });

  app.post("/api/servicetitan/:tenantId/services/:serviceId/image", requireUserOrAdmin, async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const serviceId = Number(req.params.serviceId);
    if (isNaN(tenantId) || isNaN(serviceId)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    if (!(await canAccessTenant(req, tenantId))) {
      return res.status(403).json({ message: "You don't have access to this tenant" });
    }
    try {
      const { imageData, filename, mimeType } = uploadImageSchema.parse(req.body);
      const imageBuffer = Buffer.from(imageData, 'base64');
      const api = new ServiceTitanAPI(tenant);
      const result = await api.uploadServiceImage(serviceId, imageBuffer, filename, mimeType);
      res.json(result);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      console.error(`[UploadImage] Error uploading image:`, err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // Diagnostic endpoint: Get single service details to see raw API response
  app.get("/api/servicetitan/:tenantId/service-debug/:serviceId", requireUserOrAdmin, async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const serviceId = Number(req.params.serviceId);
    if (isNaN(tenantId) || isNaN(serviceId)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    if (!(await canAccessTenant(req, tenantId))) {
      return res.status(403).json({ message: "You don't have access to this tenant" });
    }
    try {
      const api = new ServiceTitanAPI(tenant);
      const service = await api.getServiceById(serviceId);
      console.log(`[ServiceDebug] Service ${serviceId} raw response:`, JSON.stringify(service, null, 2));
      res.json(service);
    } catch (err: any) {
      console.error(`[ServiceDebug] Error fetching service ${serviceId}:`, err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // Diagnostic endpoint: Get single material details to verify cost lookup
  app.get("/api/servicetitan/:tenantId/material-debug/:materialId", requireUserOrAdmin, async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const materialId = Number(req.params.materialId);
    if (isNaN(tenantId) || isNaN(materialId)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    if (!(await canAccessTenant(req, tenantId))) {
      return res.status(403).json({ message: "You don't have access to this tenant" });
    }
    try {
      const api = new ServiceTitanAPI(tenant);
      const material = await api.getMaterialById(materialId);
      console.log(`[MaterialDebug] Material ${materialId} raw response:`, JSON.stringify(material, null, 2));
      res.json(material);
    } catch (err: any) {
      console.error(`[MaterialDebug] Error fetching material ${materialId}:`, err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // Diagnostic endpoint: Calculate what push would do for a specific service
  app.get("/api/servicetitan/:tenantId/calculate-debug/:serviceId", requireUserOrAdmin, async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const serviceId = Number(req.params.serviceId);
    if (isNaN(tenantId) || isNaN(serviceId)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    if (!(await canAccessTenant(req, tenantId))) {
      return res.status(403).json({ message: "You don't have access to this tenant" });
    }
    const settings = await storage.getSettings(req.user!.id);
    const targetMePercent = parseFloat(settings.targetMePercent);
    
    try {
      const api = new ServiceTitanAPI(tenant);
      
      // Fetch the specific service
      const service = await api.getServiceById(serviceId);
      
      // Fetch all materials and build cost map
      console.log(`[CalcDebug] Fetching all materials...`);
      const allMaterials = await api.getMaterials();
      const materialCostMap = new Map<number, number>();
      for (const mat of allMaterials) {
        materialCostMap.set(mat.id, mat.cost || 0);
      }
      console.log(`[CalcDebug] Built materials map with ${materialCostMap.size} entries`);
      
      // Fetch all equipment and build cost map
      console.log(`[CalcDebug] Fetching all equipment...`);
      const allEquipment = await api.getEquipment();
      const equipmentCostMap = new Map<number, number>();
      for (const equip of allEquipment) {
        equipmentCostMap.set(equip.id, equip.cost || 0);
      }
      console.log(`[CalcDebug] Built equipment map with ${equipmentCostMap.size} entries`);
      
      // Calculate materials cost
      let materialsCost = 0;
      const materialsBreakdown: any[] = [];
      if (service.serviceMaterials && service.serviceMaterials.length > 0) {
        for (const mat of service.serviceMaterials) {
          const cost = materialCostMap.get(mat.skuId) || 0;
          const lineCost = cost * (mat.quantity || 1);
          materialsCost += lineCost;
          materialsBreakdown.push({
            skuId: mat.skuId,
            quantity: mat.quantity,
            unitCost: cost,
            lineCost: lineCost,
            foundInMap: materialCostMap.has(mat.skuId)
          });
        }
      }
      
      // Calculate equipment cost
      let equipmentCost = 0;
      const equipmentBreakdown: any[] = [];
      if (service.serviceEquipment && service.serviceEquipment.length > 0) {
        for (const equip of service.serviceEquipment) {
          const cost = equipmentCostMap.get(equip.skuId) || 0;
          const lineCost = cost * (equip.quantity || 1);
          equipmentCost += lineCost;
          equipmentBreakdown.push({
            skuId: equip.skuId,
            quantity: equip.quantity,
            unitCost: cost,
            lineCost: lineCost,
            foundInMap: equipmentCostMap.has(equip.skuId)
          });
        }
      }
      
      const totalMeCost = materialsCost + equipmentCost;
      const calculatedPrice = totalMeCost > 0 ? totalMeCost / (targetMePercent / 100) : 0;
      const roundedPrice = Math.ceil(calculatedPrice);
      
      const result = {
        serviceId: service.id,
        serviceName: service.displayName,
        currentPrice: service.price,
        currentCost: service.cost,
        targetMePercent,
        materialsCount: service.serviceMaterials?.length || 0,
        equipmentCount: service.serviceEquipment?.length || 0,
        materialsCost: Math.round(materialsCost * 100) / 100,
        equipmentCost: Math.round(equipmentCost * 100) / 100,
        totalMeCost: Math.round(totalMeCost * 100) / 100,
        calculatedPrice: Math.round(calculatedPrice * 100) / 100,
        roundedPrice,
        wouldUpdate: totalMeCost > 0 && roundedPrice !== service.price,
        materialsBreakdown,
        equipmentBreakdown,
        materialMapSize: materialCostMap.size,
        equipmentMapSize: equipmentCostMap.size
      };
      
      console.log(`[CalcDebug] Calculation result:`, JSON.stringify(result, null, 2));
      res.json(result);
    } catch (err: any) {
      console.error(`[CalcDebug] Error:`, err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // Test endpoint: Try different field names for updating estimated labor cost
  app.post("/api/servicetitan/:tenantId/test-cost-update/:serviceId", requireUserOrAdmin, async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const serviceId = Number(req.params.serviceId);
    const testValue = req.body.testValue || 1000;
    
    if (isNaN(tenantId) || isNaN(serviceId)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    if (!(await canAccessTenant(req, tenantId))) {
      return res.status(403).json({ message: "You don't have access to this tenant" });
    }
    
    const stApi = new ServiceTitanAPI(tenant);
    
    // Get current service state first
    const originalService = await stApi.getServiceById(serviceId);
    console.log(`[CostTest] Original service - price: ${originalService.price}, cost: ${originalService.cost}, hours: ${originalService.hours}`);
    
    // Field names to test for estimated labor cost
    const fieldsToTest = [
      { fieldName: 'laborCost', value: testValue },
      { fieldName: 'estimatedCost', value: testValue },
      { fieldName: 'estimatedLaborCost', value: testValue },
      { fieldName: 'cost', value: testValue },
    ];
    
    const results: any[] = [];
    
    for (const test of fieldsToTest) {
      try {
        const payload: any = {};
        payload[test.fieldName] = test.value;
        
        console.log(`[CostTest] Testing field "${test.fieldName}" with value ${test.value}`);
        
        const response = await fetch(
          `https://api.servicetitan.io/pricebook/v2/tenant/${tenant.tenantId}/services/${serviceId}`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${await stApi.getAccessToken()}`,
              'Content-Type': 'application/json',
              'ST-App-Key': tenant.appKey,
            },
            body: JSON.stringify(payload),
          }
        );
        
        const data = await response.json();
        
        results.push({
          fieldName: test.fieldName,
          status: response.status,
          success: response.ok,
          requestPayload: payload,
          responseCost: data.cost,
          responseHours: data.hours,
          costChanged: data.cost !== originalService.cost,
          error: !response.ok ? data : null,
        });
        
        console.log(`[CostTest] Field "${test.fieldName}" - Status: ${response.status}, Response cost: ${data.cost}`);
      } catch (err: any) {
        results.push({
          fieldName: test.fieldName,
          error: err.message,
          success: false,
        });
      }
    }
    
    // Also test updating hours to see if that changes the cost
    try {
      const hoursPayload = { hours: 10 }; // Test with 10 hours
      console.log(`[CostTest] Testing "hours" field with value 10`);
      
      const hoursResponse = await fetch(
        `https://api.servicetitan.io/pricebook/v2/tenant/${tenant.tenantId}/services/${serviceId}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${await stApi.getAccessToken()}`,
            'Content-Type': 'application/json',
            'ST-App-Key': tenant.appKey,
          },
          body: JSON.stringify(hoursPayload),
        }
      );
      
      const hoursData = await hoursResponse.json();
      
      results.push({
        fieldName: 'hours',
        status: hoursResponse.status,
        success: hoursResponse.ok,
        requestPayload: hoursPayload,
        originalHours: originalService.hours,
        responseHours: hoursData.hours,
        hoursChanged: hoursData.hours !== originalService.hours,
        originalCost: originalService.cost,
        responseCost: hoursData.cost,
        costChangedAfterHoursUpdate: hoursData.cost !== originalService.cost,
      });
      
      console.log(`[CostTest] Hours update - Original hours: ${originalService.hours}, New hours: ${hoursData.hours}, Cost: ${hoursData.cost}`);
      
      // Restore original hours if changed
      if (hoursData.hours !== originalService.hours && originalService.hours) {
        await fetch(
          `https://api.servicetitan.io/pricebook/v2/tenant/${tenant.tenantId}/services/${serviceId}`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${await stApi.getAccessToken()}`,
              'Content-Type': 'application/json',
              'ST-App-Key': tenant.appKey,
            },
            body: JSON.stringify({ hours: originalService.hours }),
          }
        );
        console.log(`[CostTest] Restored hours to ${originalService.hours}`);
      }
    } catch (err: any) {
      results.push({
        fieldName: 'hours',
        error: err.message,
        success: false,
      });
    }
    
    res.json({
      serviceId,
      originalState: {
        price: originalService.price,
        cost: originalService.cost,
        hours: originalService.hours,
      },
      testValue,
      results,
      summary: {
        fieldsAccepted: results.filter(r => r.success).map(r => r.fieldName),
        fieldsThatChangedCost: results.filter(r => r.costChanged || r.costChangedAfterHoursUpdate).map(r => r.fieldName),
      }
    });
  });

  // SSE endpoint for push progress updates
  app.get("/api/servicetitan/:tenantId/push/progress", requireUserOrAdmin, async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (isNaN(tenantId)) {
      return res.status(400).json({ message: "Invalid tenant ID" });
    }
    if (!(await canAccessTenant(req, tenantId))) {
      return res.status(403).json({ message: "You don't have access to this tenant" });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Tell the browser to wait 3 seconds before reconnecting after a drop
    res.write('retry: 3000\n\n');
    res.flushHeaders();

    // Send current progress immediately so a reconnecting client is up to date
    const currentProgress = pushProgressEmitter.getProgress(tenantId);
    if (currentProgress) {
      res.write(`data: ${JSON.stringify(currentProgress)}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ stage: 'connected', message: 'Connected to progress stream', current: 0, total: 0, percent: 0 })}\n\n`);
    }

    let listenerRemoved = false;

    // Heartbeat comment every 25 seconds keeps the connection alive through proxies
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        cleanup();
      }
    }, 25000);
    
    // Cleanup helper to ensure we only remove once
    const cleanup = () => {
      if (!listenerRemoved) {
        listenerRemoved = true;
        clearInterval(heartbeat);
        pushProgressEmitter.off('progress', onProgress);
      }
    };

    // Listen for progress events
    const onProgress = (progressTenantId: number, progress: any) => {
      if (progressTenantId === tenantId) {
        res.write(`data: ${JSON.stringify(progress)}\n\n`);
        
        // Close connection when complete or error
        if (progress.stage === 'complete' || progress.stage === 'error') {
          cleanup(); // Remove listener before ending response
          setTimeout(() => {
            res.end();
          }, 100);
        }
      }
    };

    pushProgressEmitter.on('progress', onProgress);

    // Clean up on client disconnect or response finish
    req.on('close', cleanup);
    res.on('finish', cleanup);
  });

  // Get push queue status (admin-only — exposes cross-tenant operational data)
  app.get("/api/servicetitan/push-queue/status", requireAdmin, async (_req, res) => {
    const status = pushQueue.getStatus();
    res.json({
      activeCount: status.active.length,
      queueLength: status.queued.length,
      maxConcurrent: MAX_CONCURRENT_PUSHES,
      canStart: pushQueue.canStart(),
      active: status.active,
      queued: status.queued
    });
  });

  // Push M&E calculations to ServiceTitan
  app.post("/api/servicetitan/:tenantId/push", requireUserOrAdmin, async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (isNaN(tenantId)) {
      return res.status(400).json({ message: "Invalid tenant ID" });
    }
    
    const { 
      categoryIds, 
      targetMePercent, 
      roundUp,
      historyId: clientHistoryId, // Optional: frontend may have already created history
      salesTaxPercent: clientSalesTaxPercent,
      laborMode: clientLaborMode,
      laborPercent: clientLaborPercent,
      laborHourlyRate: clientLaborHourlyRate,
      numTechs: clientNumTechs,
      laborBurdenPercent: clientLaborBurdenPercent,
      commissionPercent: clientCommissionPercent,
      commissionBurdenPercent: clientCommissionBurdenPercent,
      financingFeePercent: clientFinancingFeePercent,
      skipZeroEquipment: clientSkipZeroEquipment,
      zeroEquipmentSetZeroPrice: clientZeroEquipmentSetZeroPrice,
    } = req.body;
    const skipZeroEquipment = Boolean(clientSkipZeroEquipment);
    const zeroEquipmentSetZeroPrice = Boolean(clientZeroEquipmentSetZeroPrice);
    
    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      return res.status(400).json({ message: "No categories selected" });
    }
    if (typeof targetMePercent !== 'number' || targetMePercent <= 0) {
      return res.status(400).json({ message: "Invalid target M&E percent" });
    }
    
    const shouldRoundUp = Boolean(roundUp);
    
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    if (!(await canAccessTenant(req, tenantId))) {
      return res.status(403).json({ message: "You don't have access to this tenant" });
    }
    if (req.user?.role !== "admin" && req.user?.pushPermission === "add_new_only") {
      return res.status(403).json({ message: "You don't have permission to reprice the pricebook" });
    }
    
    // Prepare push parameters
    const salesTaxPercent = clientSalesTaxPercent ?? 6.35;
    const laborMode = clientLaborMode || 'percent';
    const laborPercent = clientLaborPercent ?? 7;
    const laborHourlyRate = clientLaborHourlyRate ?? 125;
    const numTechs = (typeof clientNumTechs === 'number' && clientNumTechs >= 1) ? clientNumTechs : 1;
    const laborBurdenPercent = clientLaborBurdenPercent ?? 20;
    const commissionPercent = clientCommissionPercent ?? 10;
    const commissionBurdenPercent = clientCommissionBurdenPercent ?? 20;
    const financingFeePercent = clientFinancingFeePercent ?? 6;
    
    // Get or create history ID
    let historyId = clientHistoryId;
    
    // Queue if:
    //  a) this tenant already has an active push (→ per-tenant lane), or
    //  b) the global concurrent-tenant cap is reached (→ global queue)
    if (pushQueue.isActive(tenantId) || !pushQueue.canStart()) {
      // Create a pending history record if not already created
      if (!historyId) {
        const history = await storage.createPushHistory({
          tenantId,
          status: 'pending',
          pushType: 'update',
          categoryIds: JSON.stringify(categoryIds),
          targetMePercent: targetMePercent.toString(),
          salesTaxPercent: salesTaxPercent.toString(),
          laborMode,
          laborHourlyRate: laborHourlyRate.toString(),
          laborPercent: laborPercent.toString(),
          laborBurdenPercent: laborBurdenPercent.toString(),
          commissionPercent: commissionPercent.toString(),
          commissionBurdenPercent: commissionBurdenPercent.toString(),
          financingFeePercent: financingFeePercent.toString(),
          roundUp: shouldRoundUp,
          skipZeroEquipment,
          pushedByUserId: req.user?.id ?? null,
          pushedByName: req.user?.name ?? null,
        });
        historyId = history.id;
      } else {
        // Update existing history to pending
        await storage.updatePushHistory(historyId, { status: 'pending' });
      }
      
      // Persist transient options so processQueuedPush can use them
      pendingPushExtras.set(historyId, { skipZeroEquipment, zeroEquipmentSetZeroPrice });

      // Route to the correct lane and get back the position
      const { position: queuePosition, lane } = pushQueue.addToQueue(tenantId, historyId);
      const queueMsg = lane === 'tenant'
        ? `Push queued at position ${queuePosition} for this tenant. Will start automatically when the current push completes.`
        : `Push queued at position ${queuePosition}. Will auto-start when a global slot opens.`;
      
      // Return 202 Accepted - push is queued and will auto-start
      return res.status(202).json({ 
        message: queueMsg,
        queued: true,
        historyId,
        queuePosition,
        activeCount: pushQueue.getActiveCount(),
        maxConcurrent: MAX_CONCURRENT_PUSHES
      });
    }
    
    // Register this push as active
    if (!historyId) {
      // Create in_progress history record
      const history = await storage.createPushHistory({
        tenantId,
        status: 'in_progress',
        pushType: 'update',
        categoryIds: JSON.stringify(categoryIds),
        targetMePercent: targetMePercent.toString(),
        salesTaxPercent: salesTaxPercent.toString(),
        laborMode,
        laborHourlyRate: laborHourlyRate.toString(),
        laborPercent: laborPercent.toString(),
        laborBurdenPercent: laborBurdenPercent.toString(),
        commissionPercent: commissionPercent.toString(),
        commissionBurdenPercent: commissionBurdenPercent.toString(),
        financingFeePercent: financingFeePercent.toString(),
        roundUp: shouldRoundUp,
        skipZeroEquipment,
        pushedByUserId: req.user?.id ?? null,
        pushedByName: req.user?.name ?? null,
      });
      historyId = history.id;
      // Set startedAt separately
      await storage.updatePushHistory(historyId, { startedAt: new Date() });
    } else {
      // Update existing history to in_progress
      await storage.updatePushHistory(historyId, { status: 'in_progress', startedAt: new Date() });
    }
    
    pushQueue.startPush(tenantId, historyId);
    
    // Respond immediately — push runs in the background
    res.json({ 
      message: "Push started",
      historyId,
      queued: false,
    });
    
    // Process push in background (no await — fire and forget)
    processPush({
      tenantId,
      historyId,
      categoryIds,
      targetMePercent,
      roundUp: shouldRoundUp,
      salesTaxPercent,
      laborMode,
      laborPercent,
      laborHourlyRate,
      numTechs,
      laborBurdenPercent,
      commissionPercent,
      commissionBurdenPercent,
      financingFeePercent,
      skipZeroEquipment,
      zeroEquipmentSetZeroPrice,
    }, tenant).then(async (results) => {
      let finalStatus: 'completed' | 'cancelled' = 'completed';
      if (results.cancelled) {
        finalStatus = 'cancelled';
      }
      
      await storage.updatePushHistory(historyId, {
        status: finalStatus,
        completedAt: new Date(),
        processedCount: results.processed,
        updatedCount: results.updated,
        skippedCount: results.skipped,
        errorCount: results.errors.length,
        errorMessages: results.errors.length > 0 ? JSON.stringify(results.errors) : null,
        originalValues: results.originalValues,
      });

      // Notify opted-in admins by email (fire-and-forget)
      storage.getAdminEmailSubscribers().then(subscribers => {
        if (subscribers.length > 0) {
          sendPushCompleteNotification(subscribers.map(u => ({ email: u.email, name: u.name })), {
            tenantName: tenant.name,
            pushedByName: req.user?.name ?? 'Unknown',
            status: finalStatus,
            processedCount: results.processed,
            updatedCount: results.updated,
            skippedCount: results.skipped,
            errorCount: results.errors.length,
          }).catch(e => console.error('[Push] Email notification failed:', e));
        }
      }).catch(() => {});

      pushQueue.completePush(tenantId);
      console.log(`[Push] Background push for tenant ${tenantId} (history ${historyId}) completed: ${results.updated} updated, ${results.skipped} skipped, ${results.errors.length} errors`);
    }).catch(async (err: any) => {
      await storage.updatePushHistory(historyId, {
        status: 'failed',
        completedAt: new Date(),
        errorMessages: JSON.stringify([err.message || 'Push failed']),
        errorCount: 1,
      });
      storage.getAdminEmailSubscribers().then(subscribers => {
        if (subscribers.length > 0) {
          sendPushCompleteNotification(subscribers.map(u => ({ email: u.email, name: u.name })), {
            tenantName: tenant.name,
            pushedByName: req.user?.name ?? 'Unknown',
            status: 'failed',
            processedCount: 0,
            updatedCount: 0,
            skippedCount: 0,
            errorCount: 1,
          }).catch(() => {});
        }
      }).catch(() => {});

      pushQueue.completePush(tenantId);
      emitProgress(tenantId, 'error', `Push failed: ${err.message}`, 0, 0);
      console.error(`[Push] Background push for tenant ${tenantId} (history ${historyId}) failed:`, err.message);
    });
  });

  // Update Repairs Push — uses Repair Calculator formula
  app.post("/api/servicetitan/:tenantId/push-repair", requireUserOrAdmin, async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (isNaN(tenantId)) {
      return res.status(400).json({ message: "Invalid tenant ID" });
    }

    const {
      categoryIds,
      materialMarkupPercent,
      salesTaxPercent: clientSalesTaxPercent,
      laborMode: clientLaborMode,
      afterHours: clientAfterHours,
      laborHourlyRate: clientLaborHourlyRate,
      numTechs: clientRepairNumTechs,
      laborBurdenPercent: clientLaborBurdenPercent,
      commissionPercent: clientCommissionPercent,
      commissionBurdenPercent: clientCommissionBurdenPercent,
      financingFeePercent: clientFinancingFeePercent,
      roundUp,
      skipNoMaterials: clientSkipNoMaterials,
    } = req.body;
    const afterHours = Boolean(clientAfterHours);

    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      return res.status(400).json({ message: "No categories selected" });
    }
    if (typeof materialMarkupPercent !== 'number' || materialMarkupPercent < 0) {
      return res.status(400).json({ message: "Invalid material markup percent" });
    }

    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    if (!(await canAccessTenant(req, tenantId))) {
      return res.status(403).json({ message: "You don't have access to this tenant" });
    }
    if (req.user?.role !== "admin" && req.user?.pushPermission === "add_new_only") {
      return res.status(403).json({ message: "You don't have permission to reprice the pricebook" });
    }

    const salesTaxPercent = clientSalesTaxPercent ?? 6.35;
    const laborMode = clientLaborMode || 'hours';
    const laborHourlyRate = clientLaborHourlyRate ?? 125;
    const repairNumTechs = (typeof clientRepairNumTechs === 'number' && clientRepairNumTechs >= 1) ? clientRepairNumTechs : 1;
    const laborBurdenPercent = clientLaborBurdenPercent ?? 20;
    const commissionPercent = clientCommissionPercent ?? 10;
    // commissionBurdenPercent uses the same burden rate as labor (matching RepairCalculator.tsx)
    const commissionBurdenPercent = clientCommissionBurdenPercent ?? laborBurdenPercent;
    const financingFeePercent = clientFinancingFeePercent ?? 4;
    const shouldRoundUp = Boolean(roundUp);
    const skipNoMaterials = Boolean(clientSkipNoMaterials);

    const historyBase = {
      tenantId,
      pushType: 'update_repair',
      categoryIds: JSON.stringify(categoryIds),
      targetMePercent: materialMarkupPercent.toString(), // repurposed: stores markup %
      salesTaxPercent: salesTaxPercent.toString(),
      laborMode,
      laborHourlyRate: laborHourlyRate.toString(),
      laborPercent: '0',
      laborBurdenPercent: laborBurdenPercent.toString(),
      commissionPercent: commissionPercent.toString(),
      commissionBurdenPercent: commissionBurdenPercent.toString(),
      financingFeePercent: financingFeePercent.toString(),
      roundUp: shouldRoundUp,
      skipZeroEquipment: skipNoMaterials,
      pushedByUserId: req.user?.id ?? null,
      pushedByName: req.user?.name ?? null,
    };

    let historyId: number;

    if (pushQueue.isActive(tenantId) || !pushQueue.canStart()) {
      const history = await storage.createPushHistory({ ...historyBase, status: 'pending' });
      historyId = history.id;
      pendingPushExtras.set(historyId, { skipZeroEquipment: skipNoMaterials, zeroEquipmentSetZeroPrice: false });
      const { position: queuePosition, lane } = pushQueue.addToQueue(tenantId, historyId);
      const queueMsg = lane === 'tenant'
        ? `Repair push queued at position ${queuePosition} for this tenant.`
        : `Repair push queued at position ${queuePosition}.`;
      return res.status(202).json({ message: queueMsg, queued: true, historyId, queuePosition, activeCount: pushQueue.getActiveCount(), maxConcurrent: MAX_CONCURRENT_PUSHES });
    }

    const history = await storage.createPushHistory({ ...historyBase, status: 'in_progress' });
    historyId = history.id;
    await storage.updatePushHistory(historyId, { startedAt: new Date() });
    pushQueue.startPush(tenantId, historyId);

    res.json({ message: "Repair push started", historyId, queued: false });

    processRepairPush({
      tenantId,
      historyId,
      categoryIds,
      materialMarkupPercent,
      salesTaxPercent,
      laborMode,
      laborHourlyRate,
      numTechs: repairNumTechs,
      laborBurdenPercent,
      commissionPercent,
      commissionBurdenPercent,
      financingFeePercent,
      roundUp: shouldRoundUp,
      skipNoMaterials,
      afterHours,
      afterHoursPricingMultiplier: afterHours ? (tenant.afterHoursMultiplier ?? 1.5) : 1,
    }, tenant).then(async (results) => {
      const finalStatus: 'completed' | 'cancelled' = results.cancelled ? 'cancelled' : 'completed';
      await storage.updatePushHistory(historyId, {
        status: finalStatus,
        completedAt: new Date(),
        processedCount: results.processed,
        updatedCount: results.updated,
        skippedCount: results.skipped,
        errorCount: results.errors.length,
        errorMessages: results.errors.length > 0 ? JSON.stringify(results.errors) : null,
        originalValues: results.originalValues,
      });
      storage.getAdminEmailSubscribers().then(subscribers => {
        if (subscribers.length > 0) {
          sendPushCompleteNotification(subscribers.map(u => ({ email: u.email, name: u.name })), {
            tenantName: tenant.name,
            pushedByName: req.user?.name ?? 'Unknown',
            status: finalStatus,
            processedCount: results.processed,
            updatedCount: results.updated,
            skippedCount: results.skipped,
            errorCount: results.errors.length,
          }).catch(() => {});
        }
      }).catch(() => {});
      pushQueue.completePush(tenantId);
      console.log(`[RepairPush] Completed for tenant ${tenantId} (history ${historyId}): ${results.updated} updated, ${results.skipped} skipped, ${results.errors.length} errors`);
    }).catch(async (err: any) => {
      await storage.updatePushHistory(historyId, {
        status: 'failed',
        completedAt: new Date(),
        errorMessages: JSON.stringify([err.message || 'Repair push failed']),
        errorCount: 1,
      });
      pushQueue.completePush(tenantId);
      emitProgress(tenantId, 'error', `Repair push failed: ${err.message}`, 0, 0);
      console.error(`[RepairPush] Failed for tenant ${tenantId} (history ${historyId}):`, err.message);
    });
  });

  // Push History API endpoints
  app.get("/api/push-history", requireUserOrAdmin, async (req, res) => {
    try {
      const user = req.user!;
      const tenantId = req.query.tenantId ? Number(req.query.tenantId) : undefined;

      if (user.role !== "admin") {
        // Only show history for tenants the user has access to
        const allowedIds = await storage.getUserTenantIds(user.id);
        if (tenantId !== undefined) {
          if (!allowedIds.includes(tenantId)) {
            return res.status(403).json({ message: "You don't have access to this tenant" });
          }
        }
        const history = await storage.getPushHistory(tenantId);
        return res.json(history.filter(h =>
          allowedIds.includes(h.tenantId) &&
          (h.pushedByUserId === null || h.pushedByUserId === user.id)
        ));
      }

      const history = await storage.getPushHistory(tenantId);
      res.json(history);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/push-history/:id", requireUserOrAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }
      const item = await storage.getPushHistoryItem(id);
      if (!item) {
        return res.status(404).json({ message: "Push history item not found" });
      }
      if (!(await canAccessTenant(req, item.tenantId))) {
        return res.status(403).json({ message: "You don't have access to this tenant" });
      }
      res.json(item);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/push-history", requireUserOrAdmin, async (req, res) => {
    try {
      const tenantId = Number(req.body?.tenantId);
      if (!isNaN(tenantId) && !(await canAccessTenant(req, tenantId))) {
        return res.status(403).json({ message: "You don't have access to this tenant" });
      }
      const item = await storage.createPushHistory({
        ...req.body,
        pushedByUserId: req.user?.id ?? null,
        pushedByName: req.user?.name ?? null,
      });
      res.status(201).json(item);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/push-history/:id", requireUserOrAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }
      const existing = await storage.getPushHistoryItem(id);
      if (!existing) return res.status(404).json({ message: "Push history item not found" });
      if (!(await canAccessTenant(req, existing.tenantId))) {
        return res.status(403).json({ message: "You don't have access to this tenant" });
      }
      const updated = await storage.updatePushHistory(id, req.body);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/push-history/:id", requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }
      const existing = await storage.getPushHistoryItem(id);
      if (!existing) return res.status(404).json({ message: "Push history item not found" });
      if (!(await canAccessTenant(req, existing.tenantId))) {
        return res.status(403).json({ message: "You don't have access to this tenant" });
      }
      await storage.deletePushHistory(id);
      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Get live queue position for a specific push history entry
  app.get("/api/push-history/:historyId/queue-position", requireUserOrAdmin, async (req, res) => {
    try {
      const historyId = Number(req.params.historyId);
      if (isNaN(historyId)) {
        return res.status(400).json({ message: "Invalid history ID" });
      }
      const item = await storage.getPushHistoryItem(historyId);
      if (!item) {
        return res.status(404).json({ message: "History item not found" });
      }
      if (!(await canAccessTenant(req, item.tenantId))) {
        return res.status(403).json({ message: "You don't have access to this tenant" });
      }
      const { position, laneLength } = pushQueue.getQueuePositionDetails(historyId);
      res.json({ position, queueLength: laneLength });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Get pending pushes for a tenant (queue)
  app.get("/api/servicetitan/:tenantId/push-queue", requireUserOrAdmin, async (req, res) => {
    try {
      const tenantId = Number(req.params.tenantId);
      if (isNaN(tenantId)) {
        return res.status(400).json({ message: "Invalid tenant ID" });
      }
      if (!(await canAccessTenant(req, tenantId))) {
        return res.status(403).json({ message: "You don't have access to this tenant" });
      }
      const pending = await storage.getPendingPushes(tenantId);
      res.json(pending);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Cancel an in-progress push
  app.post("/api/servicetitan/:tenantId/push/cancel", requireUserOrAdmin, async (req, res) => {
    try {
      const tenantId = Number(req.params.tenantId);
      if (isNaN(tenantId)) {
        return res.status(400).json({ message: "Invalid tenant ID" });
      }
      if (!(await canAccessTenant(req, tenantId))) {
        return res.status(403).json({ message: "You don't have access to this tenant" });
      }
      
      // Request cancellation
      pushProgressEmitter.requestCancel(tenantId);
      console.log(`[Push] Cancellation requested for tenant ${tenantId}`);
      
      res.json({ success: true, message: "Cancellation requested" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Cancel a queued (pending, not-yet-started) push
  app.post("/api/push-history/:id/cancel-queued", requireUserOrAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }
      const item = await storage.getPushHistoryItem(id);
      if (!item) {
        return res.status(404).json({ message: "Push history item not found" });
      }
      if (!(await canAccessTenant(req, item.tenantId))) {
        return res.status(403).json({ message: "You don't have access to this tenant" });
      }
      if (item.status !== 'pending') {
        return res.status(400).json({ message: "Only pending (queued) pushes can be cancelled this way." });
      }
      const removed = pushQueue.removeFromQueue(id);
      if (!removed) {
        // May have just started — still mark cancelled if still pending in DB
        console.warn(`[Push] cancel-queued: history ${id} not found in queue (may have just started)`);
      }
      await storage.updatePushHistory(id, { status: 'cancelled', completedAt: new Date() });
      console.log(`[Push] Cancelled queued push history ${id} for tenant ${item.tenantId}`);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Revert a completed push using stored original values
  app.post("/api/push-history/:id/revert", requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }
      
      // Get the push history item
      const historyItem = await storage.getPushHistoryItem(id);
      if (!historyItem) {
        return res.status(404).json({ message: "Push history item not found" });
      }
      
      if (!historyItem.originalValues) {
        return res.status(400).json({ message: "No original values stored for this push. Cannot revert." });
      }
      
      if (historyItem.status === 'reverted') {
        return res.status(400).json({ message: "This push has already been reverted." });
      }
      
      // Check tenant access
      if (!(await canAccessTenant(req, historyItem.tenantId))) {
        return res.status(403).json({ message: "You don't have access to this tenant" });
      }

      // Get the tenant for API access
      const tenant = await storage.getTenant(historyItem.tenantId);
      if (!tenant) {
        return res.status(404).json({ message: "Tenant not found" });
      }
      
      // Parse original values
      const originalValues: Array<{ serviceId: number; originalPrice: number; originalCost: number }> = JSON.parse(historyItem.originalValues);
      
      if (originalValues.length === 0) {
        return res.status(400).json({ message: "No services to revert." });
      }
      
      console.log(`[Revert] Starting revert for push history ${id}, ${originalValues.length} services`);
      
      const stApi = new ServiceTitanAPI(tenant);
      let reverted = 0;
      const errors: string[] = [];
      
      for (const item of originalValues) {
        try {
          await stApi.updateService(item.serviceId, {
            price: item.originalPrice,
            cost: item.originalCost
          });
          reverted++;
        } catch (err: any) {
          errors.push(`Failed to revert service ${item.serviceId}: ${err.message}`);
        }
      }
      
      console.log(`[Revert] Completed: ${reverted} of ${originalValues.length} services reverted, ${errors.length} errors`);
      
      // Update the push history status to reverted
      await storage.updatePushHistory(id, { 
        status: 'reverted',
        errorMessages: errors.length > 0 ? JSON.stringify(errors) : null
      });
      
      res.json({ 
        success: true, 
        reverted, 
        total: originalValues.length,
        errors 
      });
    } catch (err: any) {
      console.error(`[Revert] Error: ${err.message}`);
      res.status(500).json({ message: err.message });
    }
  });

  // Retry a previous push with identical settings — creates a new history record
  app.post("/api/push-history/:id/retry", requireUserOrAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const historyItem = await storage.getPushHistoryItem(id);
      if (!historyItem) {
        return res.status(404).json({ message: "Push history item not found" });
      }

      if (!(await canAccessTenant(req, historyItem.tenantId))) {
        return res.status(403).json({ message: "You don't have access to this tenant" });
      }

      const tenant = await storage.getTenant(historyItem.tenantId);
      if (!tenant) {
        return res.status(404).json({ message: "Tenant not found" });
      }

      const tenantId = historyItem.tenantId;


      // Re-parse all settings from the stored history record
      const categoryIds: number[] = JSON.parse(historyItem.categoryIds);
      const targetMePercent = parseFloat(historyItem.targetMePercent);
      const salesTaxPercent = parseFloat(historyItem.salesTaxPercent);
      const laborMode = historyItem.laborMode;
      const laborHourlyRate = parseFloat(historyItem.laborHourlyRate);
      const laborHours = parseFloat(historyItem.laborHours ?? '8');
      const laborPercent = parseFloat(historyItem.laborPercent);
      const laborBurdenPercent = parseFloat(historyItem.laborBurdenPercent);
      const commissionPercent = parseFloat(historyItem.commissionPercent);
      const commissionBurdenPercent = parseFloat(historyItem.commissionBurdenPercent);
      const financingFeePercent = parseFloat(historyItem.financingFeePercent);
      const roundUp = historyItem.roundUp;
      const skipZeroEquipment = historyItem.skipZeroEquipment ?? false;

      const isRepairRetry = historyItem.pushType === 'update_repair';

      const historyBase = {
        tenantId,
        pushType: historyItem.pushType ?? 'update',
        categoryIds: JSON.stringify(categoryIds),
        targetMePercent: targetMePercent.toString(),
        salesTaxPercent: salesTaxPercent.toString(),
        laborMode,
        laborHourlyRate: laborHourlyRate.toString(),
        laborPercent: laborPercent.toString(),
        laborBurdenPercent: laborBurdenPercent.toString(),
        commissionPercent: commissionPercent.toString(),
        commissionBurdenPercent: commissionBurdenPercent.toString(),
        financingFeePercent: financingFeePercent.toString(),
        roundUp,
        skipZeroEquipment,
        pushedByUserId: req.user?.id ?? null,
        pushedByName: req.user?.name ?? null,
      };

      let newHistoryId: number;
      let queued = false;

      if (pushQueue.isActive(tenantId) || !pushQueue.canStart()) {
        const newHistory = await storage.createPushHistory({ ...historyBase, status: 'pending' });
        newHistoryId = newHistory.id;
        pendingPushExtras.set(newHistoryId, { skipZeroEquipment, zeroEquipmentSetZeroPrice: false });
        pushQueue.addToQueue(tenantId, newHistoryId);
        queued = true;
      } else {
        const newHistory = await storage.createPushHistory({ ...historyBase, status: 'in_progress' });
        newHistoryId = newHistory.id;
        await storage.updatePushHistory(newHistoryId, { startedAt: new Date() });
        pushQueue.startPush(tenantId, newHistoryId);

        const retryPromise = isRepairRetry
          ? processRepairPush({
              tenantId,
              historyId: newHistoryId,
              categoryIds,
              materialMarkupPercent: targetMePercent, // stored in targetMePercent column
              salesTaxPercent,
              laborMode,
              laborHourlyRate,
              laborBurdenPercent,
              commissionPercent,
              commissionBurdenPercent,
              financingFeePercent,
              roundUp,
              skipNoMaterials: skipZeroEquipment,
            }, tenant)
          : processPush({
              tenantId,
              historyId: newHistoryId,
              categoryIds,
              targetMePercent,
              roundUp,
              salesTaxPercent,
              laborMode,
              laborPercent,
              laborHourlyRate,
              laborBurdenPercent,
              commissionPercent,
              commissionBurdenPercent,
              financingFeePercent,
              skipZeroEquipment,
            }, tenant);

        retryPromise.then(async (results) => {
          const finalStatus: 'completed' | 'cancelled' = results.cancelled ? 'cancelled' : 'completed';
          await storage.updatePushHistory(newHistoryId, {
            status: finalStatus,
            completedAt: new Date(),
            processedCount: results.processed,
            updatedCount: results.updated,
            skippedCount: results.skipped,
            errorCount: results.errors.length,
            errorMessages: results.errors.length > 0 ? JSON.stringify(results.errors) : null,
            originalValues: results.originalValues,
          });
          storage.getAdminEmailSubscribers().then(subscribers => {
            if (subscribers.length > 0) {
              sendPushCompleteNotification(subscribers.map(u => ({ email: u.email, name: u.name })), {
                tenantName: tenant.name,
                pushedByName: req.user?.name ?? 'Unknown',
                status: finalStatus,
                processedCount: results.processed,
                updatedCount: results.updated,
                skippedCount: results.skipped,
                errorCount: results.errors.length,
              }).catch(() => {});
            }
          }).catch(() => {});
          pushQueue.completePush(tenantId);
          console.log(`[Retry] Push for tenant ${tenantId} (history ${newHistoryId}) completed: ${results.updated} updated, ${results.errors.length} errors`);
        }).catch(async (err: any) => {
          await storage.updatePushHistory(newHistoryId, {
            status: 'failed',
            completedAt: new Date(),
            errorMessages: JSON.stringify([err.message || 'Push failed']),
            errorCount: 1,
          });
          pushQueue.completePush(tenantId);
          emitProgress(tenantId, 'error', `Push failed: ${err.message}`, 0, 0);
          console.error(`[Retry] Push for tenant ${tenantId} (history ${newHistoryId}) failed:`, err.message);
        });
      }

      res.json({ historyId: newHistoryId, queued });
    } catch (err: any) {
      console.error(`[Retry] Error: ${err.message}`);
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}
