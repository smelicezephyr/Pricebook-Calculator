import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { ServiceTitanAPI } from "./servicetitan";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
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
    isActive: tenant.isActive,
    createdAt: tenant.createdAt,
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

  // Push M&E calculations to ServiceTitan
  app.post("/api/servicetitan/:tenantId/push", async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (isNaN(tenantId)) {
      return res.status(400).json({ message: "Invalid tenant ID" });
    }
    
    const { categoryIds, targetMePercent } = req.body;
    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      return res.status(400).json({ message: "No categories selected" });
    }
    if (typeof targetMePercent !== 'number' || targetMePercent <= 0) {
      return res.status(400).json({ message: "Invalid target M&E percent" });
    }
    
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    
    try {
      const stApi = new ServiceTitanAPI(tenant);
      const results = {
        processed: 0,
        updated: 0,
        errors: [] as string[],
      };
      
      for (const categoryId of categoryIds) {
        try {
          const services = await stApi.getServices(categoryId);
          
          for (const service of services) {
            results.processed++;
            
            // Calculate total M&E cost from materials and equipment
            let totalMeCost = 0;
            
            if (service.materials) {
              for (const mat of service.materials) {
                totalMeCost += (mat.cost || 0) * (mat.quantity || 1);
              }
            }
            
            if (service.equipment) {
              for (const equip of service.equipment) {
                totalMeCost += (equip.cost || 0) * (equip.quantity || 1);
              }
            }
            
            // Skip if no M&E cost
            if (totalMeCost === 0) {
              continue;
            }
            
            // Calculate new price: M&E cost / (M&E% / 100)
            // If targetMePercent is 23%, then price = meCost / 0.23
            const newPrice = totalMeCost / (targetMePercent / 100);
            
            // Only update if price changed significantly
            const currentPrice = service.price || 0;
            if (Math.abs(newPrice - currentPrice) > 0.01) {
              try {
                await stApi.updateService(service.id, { 
                  price: Math.round(newPrice * 100) / 100 
                });
                results.updated++;
              } catch (updateErr: any) {
                results.errors.push(`Failed to update service ${service.name}: ${updateErr.message}`);
              }
            }
          }
        } catch (catErr: any) {
          results.errors.push(`Failed to process category ${categoryId}: ${catErr.message}`);
        }
      }
      
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}
