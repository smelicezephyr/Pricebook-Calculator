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
import { processPush } from "./pushProcessor";
import type { PushHistory } from "@shared/schema";
import { sendPushCompleteNotification } from "./email";

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

  async function canAccessTenant(req: Request, tenantId: number): Promise<boolean> {
    const role = req.user!.role;
    if (role === "admin") return true;
    if (role !== "user") return false;
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
    if (!["everyone", "user", "admin"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }
    const validRole = role as "everyone" | "user" | "admin";
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

  app.get("/api/admin/dashboard", requireAdmin, async (req, res) => {
    try {
      const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

      // Build date filter clauses
      const dateParams: string[] = [];
      const dateConditions: string[] = ["status NOT IN ('pending','in_progress')"];
      if (startDate) { dateConditions.push(`created_at >= $${dateParams.push(startDate)}`); }
      if (endDate)   { dateConditions.push(`created_at <= ($${dateParams.push(endDate)}::date + INTERVAL '1 day')`); }
      const dateWhere = dateConditions.join(" AND ");

      // For tenant join, build separate param sets
      const tenantParams: string[] = [];
      const tenantDateConds: string[] = ["ph.status NOT IN ('pending','in_progress')"];
      if (startDate) { tenantDateConds.push(`ph.created_at >= $${tenantParams.push(startDate)}`); }
      if (endDate)   { tenantDateConds.push(`ph.created_at <= ($${tenantParams.push(endDate)}::date + INTERVAL '1 day')`); }
      const tenantDateWhere = tenantDateConds.join(" AND ");

      // Monthly chart: use the date range if provided, else last 6 months
      const monthlyParams: string[] = [];
      const monthlyStart = startDate || null;
      const monthlyEnd   = endDate   || null;
      const monthlyConds: string[] = ["status NOT IN ('pending','in_progress')"];
      if (monthlyStart) { monthlyConds.push(`created_at >= $${monthlyParams.push(monthlyStart)}`); }
      else               { monthlyConds.push(`created_at >= NOW() - INTERVAL '6 months'`); }
      if (monthlyEnd)   { monthlyConds.push(`created_at <= ($${monthlyParams.push(monthlyEnd)}::date + INTERVAL '1 day')`); }
      const monthlyWhere = monthlyConds.join(" AND ");

      const [overallResult, tenantResult, monthlyResult, userResult] = await Promise.all([
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
            COUNT(ph.id) AS total_pushes,
            COUNT(ph.id) FILTER (WHERE ph.status = 'completed') AS completed,
            COUNT(ph.id) FILTER (WHERE ph.status = 'failed') AS failed,
            COALESCE(SUM(ph.updated_count), 0) AS total_updated,
            MAX(ph.created_at) AS last_push
          FROM tenants t
          LEFT JOIN push_history ph ON ph.tenant_id = t.id
            AND ${tenantDateWhere}
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
        pool.query(`SELECT COUNT(*) AS active_users FROM users WHERE role != 'everyone'`),
      ]);

      const o = overallResult.rows[0];
      const total = Number(o.completed) + Number(o.failed);
      res.json({
        totalPushes: Number(o.total_pushes),
        completedPushes: Number(o.completed),
        failedPushes: Number(o.failed),
        totalUpdated: Number(o.total_updated),
        successRate: total > 0 ? Math.round((Number(o.completed) / total) * 100) : null,
        activeTenants: Number(o.active_tenants),
        activeUsers: Number(userResult.rows[0].active_users),
        byTenant: tenantResult.rows.map(r => ({
          id: Number(r.id),
          name: r.name,
          totalPushes: Number(r.total_pushes),
          completed: Number(r.completed),
          failed: Number(r.failed),
          totalUpdated: Number(r.total_updated),
          lastPush: r.last_push,
          successRate: (Number(r.completed) + Number(r.failed)) > 0
            ? Math.round((Number(r.completed) / (Number(r.completed) + Number(r.failed))) * 100)
            : null,
        })),
        monthly: monthlyResult.rows.map(r => ({
          month: r.month,
          pushes: Number(r.pushes),
          updated: Number(r.updated),
        })),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/history/logins", requireAdmin, async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const events = await storage.listLoginEvents(limit);
    res.json(events);
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
    const settings = await storage.getSettings();
    res.json(settings);
  });

  app.put(api.settings.update.path, requireAdmin, async (req, res) => {
    try {
      const input = api.settings.update.input.parse(req.body);
      const updated = await storage.updateSettings(input);
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
  app.get(api.tenants.list.path, requireUserOrAdmin, async (req, res) => {
    const allTenants = await storage.getTenants();
    const user = req.user!;
    if (user.role === "admin") {
      return res.json(allTenants.map(sanitizeTenant));
    }
    // user role: only return tenants they're assigned to
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
      res.json(categories.filter((c: any) => c.active === true));
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
    const settings = await storage.getSettings();
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
      laborBurdenPercent: clientLaborBurdenPercent,
      commissionPercent: clientCommissionPercent,
      commissionBurdenPercent: clientCommissionBurdenPercent,
      financingFeePercent: clientFinancingFeePercent,
    } = req.body;
    
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
          pushedByUserId: req.user?.id ?? null,
          pushedByName: req.user?.name ?? null,
        });
        historyId = history.id;
      } else {
        // Update existing history to pending
        await storage.updatePushHistory(historyId, { status: 'pending' });
      }
      
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
      laborBurdenPercent,
      commissionPercent,
      commissionBurdenPercent,
      financingFeePercent,
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

      const historyBase = {
        tenantId,
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
        pushedByUserId: req.user?.id ?? null,
        pushedByName: req.user?.name ?? null,
      };

      let newHistoryId: number;
      let queued = false;

      if (pushQueue.isActive(tenantId) || !pushQueue.canStart()) {
        const newHistory = await storage.createPushHistory({ ...historyBase, status: 'pending' });
        newHistoryId = newHistory.id;
        pushQueue.addToQueue(tenantId, newHistoryId);
        queued = true;
      } else {
        const newHistory = await storage.createPushHistory({ ...historyBase, status: 'in_progress' });
        newHistoryId = newHistory.id;
        await storage.updatePushHistory(newHistoryId, { startedAt: new Date() });
        pushQueue.startPush(tenantId, newHistoryId);

        processPush({
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
        }, tenant).then(async (results) => {
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
