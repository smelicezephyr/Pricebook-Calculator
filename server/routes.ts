import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { ServiceTitanAPI } from "./servicetitan";
import { pushProgressEmitter, emitProgress } from "./pushProgress";
import { pushQueue, withRetry, MAX_CONCURRENT_PUSHES } from "./pushQueue";
import { processPush } from "./pushProcessor";
import type { PushHistory } from "@shared/schema";

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

  // Health check endpoint for deployment
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // Settings Routes
  app.get(api.settings.get.path, async (req, res) => {
    const settings = await storage.getSettings();
    res.json(settings);
  });

  app.put(api.settings.update.path, async (req, res) => {
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

  // Admin Routes - IP-based authentication
  // Store unlocked IPs with expiration (8 hours)
  const unlockedIPs = new Map<string, number>(); // IP -> expiration timestamp
  const AUTH_DURATION = 8 * 60 * 60 * 1000; // 8 hours in milliseconds

  const getClientIP = (req: any): string => {
    // Check for forwarded IP (behind proxy/load balancer)
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      return (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',')[0].trim();
    }
    return req.ip || req.connection?.remoteAddress || 'unknown';
  };

  const isIPUnlocked = (ip: string): boolean => {
    const expiration = unlockedIPs.get(ip);
    if (!expiration) return false;
    if (Date.now() > expiration) {
      unlockedIPs.delete(ip);
      return false;
    }
    return true;
  };

  // Check if current IP is authenticated
  app.get("/api/admin/check-auth", (req, res) => {
    const ip = getClientIP(req);
    const unlocked = isIPUnlocked(ip);
    res.json({ unlocked, ip });
  });

  app.post("/api/admin/verify-password", async (req, res) => {
    try {
      const { password } = req.body;
      const settings = await storage.getSettings();
      const valid = password === settings.serviceTitanPassword;
      
      if (valid) {
        const ip = getClientIP(req);
        unlockedIPs.set(ip, Date.now() + AUTH_DURATION);
        console.log(`[Auth] IP ${ip} unlocked ServiceTitan section`);
      }
      
      res.json({ valid });
    } catch (err) {
      res.status(500).json({ valid: false, error: "Failed to verify password" });
    }
  });

  // Lock the current IP
  app.post("/api/admin/lock", (req, res) => {
    const ip = getClientIP(req);
    unlockedIPs.delete(ip);
    console.log(`[Auth] IP ${ip} locked ServiceTitan section`);
    res.json({ success: true });
  });

  app.post("/api/admin/change-password", async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const settings = await storage.getSettings();
      
      if (currentPassword !== settings.serviceTitanPassword) {
        return res.json({ success: false, error: "Current password is incorrect" });
      }
      
      if (!newPassword || newPassword.length < 4) {
        return res.json({ success: false, error: "New password must be at least 4 characters" });
      }
      
      await storage.updateSettings({ serviceTitanPassword: newPassword });
      
      // Clear all unlocked IPs when password changes
      unlockedIPs.clear();
      console.log("[Auth] Password changed, all IPs locked");
      
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to change password" });
    }
  });

  app.delete("/api/admin/clear-history", async (req, res) => {
    try {
      await storage.clearAllQuotes();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to clear history" });
    }
  });

  // Admin PIN Routes - IP-based authentication (separate from ServiceTitan password)
  const unlockedAdminIPs = new Map<string, number>(); // IP -> expiration timestamp

  app.get("/api/admin/check-pin-auth", (req, res) => {
    const ip = getClientIP(req);
    const expiration = unlockedAdminIPs.get(ip);
    const unlocked = expiration ? Date.now() <= expiration : false;
    if (!unlocked && expiration) {
      unlockedAdminIPs.delete(ip);
    }
    res.json({ unlocked, ip });
  });

  app.post("/api/admin/verify-pin", async (req, res) => {
    try {
      const { pin } = req.body;
      const settings = await storage.getSettings();
      const valid = pin === settings.adminPin;
      
      if (valid) {
        const ip = getClientIP(req);
        unlockedAdminIPs.set(ip, Date.now() + AUTH_DURATION);
        console.log(`[Auth] IP ${ip} unlocked Admin section`);
      }
      
      res.json({ valid });
    } catch (err) {
      res.status(500).json({ valid: false, error: "Failed to verify PIN" });
    }
  });

  app.post("/api/admin/lock-pin", (req, res) => {
    const ip = getClientIP(req);
    unlockedAdminIPs.delete(ip);
    console.log(`[Auth] IP ${ip} locked Admin section`);
    res.json({ success: true });
  });

  app.post("/api/admin/change-pin", async (req, res) => {
    try {
      const { currentPin, newPin } = req.body;
      const settings = await storage.getSettings();
      
      if (currentPin !== settings.adminPin) {
        return res.json({ success: false, error: "Current PIN is incorrect" });
      }
      
      if (!newPin || newPin.length < 4) {
        return res.json({ success: false, error: "New PIN must be at least 4 characters" });
      }
      
      await storage.updateSettings({ adminPin: newPin });
      
      // Clear all unlocked admin IPs when PIN changes
      unlockedAdminIPs.clear();
      console.log("[Auth] Admin PIN changed, all IPs locked");
      
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to change PIN" });
    }
  });

  // Quotes Routes
  app.get(api.quotes.list.path, async (req, res) => {
    const quotes = await storage.getQuotes();
    res.json(quotes);
  });

  app.post(api.quotes.create.path, async (req, res) => {
    try {
      const input = api.quotes.create.input.parse(req.body);
      const quote = await storage.createQuote(input);
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

  app.delete(api.quotes.delete.path, async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    await storage.deleteQuote(id);
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
  app.get("/api/locations", async (_req, res) => {
    const allLocations = await storage.getLocations();
    res.json(allLocations);
  });

  app.post("/api/locations", async (req, res) => {
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

  app.put("/api/locations/:id", async (req, res) => {
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

  app.delete("/api/locations/:id", async (req, res) => {
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
  app.get(api.tenants.list.path, async (req, res) => {
    const tenants = await storage.getTenants();
    res.json(tenants.map(sanitizeTenant));
  });

  app.get(api.tenants.get.path, async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const tenant = await storage.getTenant(id);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    res.json(sanitizeTenant(tenant));
  });

  app.post(api.tenants.create.path, async (req, res) => {
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

  app.put(api.tenants.update.path, async (req, res) => {
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

  app.delete(api.tenants.delete.path, async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    await storage.deleteTenant(id);
    res.status(204).send();
  });

  // Reorder tenants
  app.post("/api/tenants/reorder", async (req, res) => {
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

  // Get full tenant data (unmasked) for editing - only for password-protected section
  app.get("/api/tenants/:id/full", async (req, res) => {
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
  app.post("/api/servicetitan/:tenantId/test", async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (isNaN(tenantId)) {
      return res.status(400).json({ success: false, message: "Invalid tenant ID" });
    }
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ success: false, message: "Tenant not found" });
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

  app.get("/api/servicetitan/:tenantId/categories", async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (isNaN(tenantId)) {
      return res.status(400).json({ message: "Invalid tenant ID" });
    }
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    try {
      const api = new ServiceTitanAPI(tenant);
      const categories = await api.getCategories();
      res.json(categories);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/servicetitan/:tenantId/services", async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
    if (isNaN(tenantId)) {
      return res.status(400).json({ message: "Invalid tenant ID" });
    }
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    try {
      const api = new ServiceTitanAPI(tenant);
      const services = await api.getServices(categoryId);
      res.json(services);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/servicetitan/:tenantId/services/:serviceId", async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const serviceId = Number(req.params.serviceId);
    if (isNaN(tenantId) || isNaN(serviceId)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    try {
      const api = new ServiceTitanAPI(tenant);
      const updated = await api.updateService(serviceId, req.body);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/servicetitan/:tenantId/gl-accounts", async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (isNaN(tenantId)) {
      return res.status(400).json({ message: "Invalid tenant ID" });
    }
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
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
  app.get("/api/servicetitan/:tenantId/services/:serviceId/debug", async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const serviceId = Number(req.params.serviceId);
    if (isNaN(tenantId) || isNaN(serviceId)) {
      return res.status(400).json({ message: "Invalid tenant ID or service ID" });
    }
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
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

  app.post("/api/servicetitan/:tenantId/services", async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (isNaN(tenantId)) {
      return res.status(400).json({ message: "Invalid tenant ID" });
    }
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
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

  app.post("/api/servicetitan/:tenantId/services/:serviceId/image", async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const serviceId = Number(req.params.serviceId);
    if (isNaN(tenantId) || isNaN(serviceId)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
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
  app.get("/api/servicetitan/:tenantId/service-debug/:serviceId", async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const serviceId = Number(req.params.serviceId);
    if (isNaN(tenantId) || isNaN(serviceId)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
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
  app.get("/api/servicetitan/:tenantId/material-debug/:materialId", async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const materialId = Number(req.params.materialId);
    if (isNaN(tenantId) || isNaN(materialId)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
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
  app.get("/api/servicetitan/:tenantId/calculate-debug/:serviceId", async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const serviceId = Number(req.params.serviceId);
    if (isNaN(tenantId) || isNaN(serviceId)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
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
  app.post("/api/servicetitan/:tenantId/test-cost-update/:serviceId", async (req, res) => {
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
  app.get("/api/servicetitan/:tenantId/push/progress", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (isNaN(tenantId)) {
      return res.status(400).json({ message: "Invalid tenant ID" });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ stage: 'connected', message: 'Connected to progress stream', current: 0, total: 0, percent: 0 })}\n\n`);

    let listenerRemoved = false;
    
    // Cleanup helper to ensure we only remove once
    const cleanup = () => {
      if (!listenerRemoved) {
        listenerRemoved = true;
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

  // Get push queue status
  app.get("/api/servicetitan/push-queue/status", async (req, res) => {
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
  app.post("/api/servicetitan/:tenantId/push", async (req, res) => {
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
    
    // Check if this tenant already has an active push
    if (pushQueue.isActive(tenantId)) {
      return res.status(429).json({ 
        message: "This tenant already has an active push in progress.",
        queued: false,
        activeCount: pushQueue.getActiveCount()
      });
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
    
    // Check if we can start or need to queue (max 3 concurrent pushes)
    if (!pushQueue.canStart()) {
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
        });
        historyId = history.id;
      } else {
        // Update existing history to pending
        await storage.updatePushHistory(historyId, { status: 'pending' });
      }
      
      // Add to queue
      const queuePosition = pushQueue.addToQueue(tenantId, historyId);
      
      // Return 202 Accepted - push is queued and will auto-start
      return res.status(202).json({ 
        message: `Push queued at position ${queuePosition}. Will auto-start when a slot opens.`,
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
      
      pushQueue.completePush(tenantId);
      console.log(`[Push] Background push for tenant ${tenantId} (history ${historyId}) completed: ${results.updated} updated, ${results.skipped} skipped, ${results.errors.length} errors`);
    }).catch(async (err: any) => {
      await storage.updatePushHistory(historyId, {
        status: 'failed',
        completedAt: new Date(),
        errorMessages: JSON.stringify([err.message || 'Push failed']),
        errorCount: 1,
      });
      
      pushQueue.completePush(tenantId);
      emitProgress(tenantId, 'error', `Push failed: ${err.message}`, 0, 0);
      console.error(`[Push] Background push for tenant ${tenantId} (history ${historyId}) failed:`, err.message);
    });
  });

  // Push History API endpoints
  app.get("/api/push-history", async (req, res) => {
    try {
      const tenantId = req.query.tenantId ? Number(req.query.tenantId) : undefined;
      const history = await storage.getPushHistory(tenantId);
      res.json(history);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/push-history/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }
      const item = await storage.getPushHistoryItem(id);
      if (!item) {
        return res.status(404).json({ message: "Push history item not found" });
      }
      res.json(item);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/push-history", async (req, res) => {
    try {
      const item = await storage.createPushHistory(req.body);
      res.status(201).json(item);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/push-history/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }
      const updated = await storage.updatePushHistory(id, req.body);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/push-history/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }
      await storage.deletePushHistory(id);
      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Get pending pushes for a tenant (queue)
  app.get("/api/servicetitan/:tenantId/push-queue", async (req, res) => {
    try {
      const tenantId = Number(req.params.tenantId);
      if (isNaN(tenantId)) {
        return res.status(400).json({ message: "Invalid tenant ID" });
      }
      const pending = await storage.getPendingPushes(tenantId);
      res.json(pending);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Cancel an in-progress push
  app.post("/api/servicetitan/:tenantId/push/cancel", async (req, res) => {
    try {
      const tenantId = Number(req.params.tenantId);
      if (isNaN(tenantId)) {
        return res.status(400).json({ message: "Invalid tenant ID" });
      }
      
      // Request cancellation
      pushProgressEmitter.requestCancel(tenantId);
      console.log(`[Push] Cancellation requested for tenant ${tenantId}`);
      
      res.json({ success: true, message: "Cancellation requested" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Revert a completed push using stored original values
  app.post("/api/push-history/:id/revert", async (req, res) => {
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
  app.post("/api/push-history/:id/retry", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const historyItem = await storage.getPushHistoryItem(id);
      if (!historyItem) {
        return res.status(404).json({ message: "Push history item not found" });
      }

      const tenant = await storage.getTenant(historyItem.tenantId);
      if (!tenant) {
        return res.status(404).json({ message: "Tenant not found" });
      }

      const tenantId = historyItem.tenantId;

      if (pushQueue.isActive(tenantId)) {
        return res.status(429).json({ message: "This tenant already has an active push in progress." });
      }

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
      };

      let newHistoryId: number;
      let queued = false;

      if (!pushQueue.canStart()) {
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
