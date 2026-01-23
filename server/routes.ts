import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { ServiceTitanAPI } from "./servicetitan";
import { pushProgressEmitter, emitProgress } from "./pushProgress";

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

    // Listen for progress events
    const onProgress = (progressTenantId: number, progress: any) => {
      if (progressTenantId === tenantId) {
        res.write(`data: ${JSON.stringify(progress)}\n\n`);
        
        // Close connection when complete or error
        if (progress.stage === 'complete' || progress.stage === 'error') {
          setTimeout(() => {
            res.end();
          }, 100);
        }
      }
    };

    pushProgressEmitter.on('progress', onProgress);

    // Clean up on client disconnect
    req.on('close', () => {
      pushProgressEmitter.off('progress', onProgress);
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
      // Client-supplied settings (override global settings)
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
    
    // Round up flag - default to false
    const shouldRoundUp = Boolean(roundUp);
    
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    
    // Use client-supplied settings from the push UI (they may override global settings)
    const salesTaxRate = (clientSalesTaxPercent ?? 6.35) / 100;
    const laborMode = clientLaborMode || 'percent';
    const laborPercentRate = (clientLaborPercent ?? 7) / 100;
    const laborHourlyRate = clientLaborHourlyRate ?? 125;
    const laborBurdenRate = (clientLaborBurdenPercent ?? 20) / 100;
    const commissionRate = (clientCommissionPercent ?? 10) / 100;
    const commissionBurdenRate = (clientCommissionBurdenPercent ?? 20) / 100;
    const financingRate = (clientFinancingFeePercent ?? 6) / 100;
    
    console.log(`[Push] Starting push for tenant ${tenantId}, categories: [${categoryIds.join(', ')}], targetMePercent: ${targetMePercent}%, roundUp: ${shouldRoundUp}`);
    
    // Clear any previous progress
    emitProgress(tenantId, 'materials', 'Starting push...', 0, 100);
    
    try {
      const stApi = new ServiceTitanAPI(tenant);
      const results = {
        processed: 0,
        updated: 0,
        errors: [] as string[],
      };
      
      // Fetch all materials and equipment to build cost lookup maps
      console.log('[Push] Step 1: Fetching all materials...');
      emitProgress(tenantId, 'materials', 'Loading materials from ServiceTitan...', 0, 100);
      const materialsStart = Date.now();
      const allMaterials = await stApi.getMaterials((page, count) => {
        emitProgress(tenantId, 'materials', `Loading materials (page ${page})...`, count, count + 500);
      });
      console.log(`[Push] Materials fetched in ${Date.now() - materialsStart}ms`);
      emitProgress(tenantId, 'materials', `Loaded ${allMaterials.length} materials`, allMaterials.length, allMaterials.length);
      
      console.log('[Push] Step 2: Fetching all equipment...');
      emitProgress(tenantId, 'equipment', 'Loading equipment from ServiceTitan...', 0, 100);
      const equipmentStart = Date.now();
      const allEquipment = await stApi.getEquipment((page, count) => {
        emitProgress(tenantId, 'equipment', `Loading equipment (page ${page})...`, count, count + 500);
      });
      console.log(`[Push] Equipment fetched in ${Date.now() - equipmentStart}ms`);
      emitProgress(tenantId, 'equipment', `Loaded ${allEquipment.length} equipment`, allEquipment.length, allEquipment.length);
      
      // Build lookup maps: skuId -> cost
      const materialCostMap = new Map<number, number>();
      for (const mat of allMaterials) {
        materialCostMap.set(mat.id, mat.cost || 0);
      }
      
      const equipmentCostMap = new Map<number, number>();
      for (const equip of allEquipment) {
        equipmentCostMap.set(equip.id, equip.cost || 0);
      }
      
      console.log(`[Push] Loaded ${materialCostMap.size} materials and ${equipmentCostMap.size} equipment items`);
      
      // First pass: count total services to process
      emitProgress(tenantId, 'services', 'Counting services to process...', 0, 100);
      let totalServices = 0;
      const categoryServicesMap = new Map<number, any[]>();
      for (const categoryId of categoryIds) {
        try {
          const services = await stApi.getServices(categoryId);
          categoryServicesMap.set(categoryId, services);
          totalServices += services.length;
        } catch (err) {
          console.log(`[Push] Failed to fetch services for category ${categoryId}`);
        }
      }
      
      emitProgress(tenantId, 'updating', `Processing ${totalServices} services...`, 0, totalServices);
      
      for (const categoryId of categoryIds) {
        try {
          const services = categoryServicesMap.get(categoryId) || [];
          
          for (const service of services) {
            results.processed++;
            
            // Emit progress update
            emitProgress(tenantId, 'updating', `Updating service ${results.processed} of ${totalServices}...`, results.processed, totalServices);
            
            // Calculate total M&E cost from linked materials and equipment
            let materialsCost = 0;
            let equipmentCost = 0;
            
            // Use serviceMaterials (skuId references) from API response
            if (service.serviceMaterials) {
              for (const mat of service.serviceMaterials) {
                const cost = materialCostMap.get(mat.skuId) || 0;
                materialsCost += cost * (mat.quantity || 1);
              }
            }
            
            // Use serviceEquipment (skuId references) from API response
            if (service.serviceEquipment) {
              for (const equip of service.serviceEquipment) {
                const cost = equipmentCostMap.get(equip.skuId) || 0;
                equipmentCost += cost * (equip.quantity || 1);
              }
            }
            
            const rawMeCost = materialsCost + equipmentCost;
            
            // Skip if no M&E cost
            if (rawMeCost === 0) {
              continue;
            }
            
            // Calculate sales tax on M&E (same as calculator)
            const tax = rawMeCost * salesTaxRate;
            
            // Total M&E includes tax (same as calculator: totalMe = materials + equipment + tax)
            const totalMe = rawMeCost + tax;
            
            // Calculate new price: totalMe / (M&E% / 100) - matching calculator formula
            const newPrice = totalMe / (targetMePercent / 100);
            
            // Calculate labor cost based on mode
            let laborCost = 0;
            if (laborMode === 'hours') {
              const hours = service.hours || 0;
              laborCost = (hours * laborHourlyRate) * (1 + laborBurdenRate);
            } else {
              // Percent mode: labor is percentage of price with burden
              laborCost = (newPrice * laborPercentRate) * (1 + laborBurdenRate);
            }
            
            // Calculate commission cost (percentage of price with burden)
            const commissionCost = (newPrice * commissionRate) * (1 + commissionBurdenRate);
            
            // Calculate financing cost
            const financingCost = newPrice * financingRate;
            
            // Calculate estimated labor (same formula as calculator)
            // estimatedLabor = laborCost + commissionCost + tax + financingCost
            const estimatedLabor = laborCost + commissionCost + tax + financingCost;
            
            // Round values - use Math.ceil for price if roundUp is enabled
            const roundedPrice = shouldRoundUp ? Math.ceil(newPrice) : Math.round(newPrice * 100) / 100;
            const roundedCost = Math.round(estimatedLabor * 100) / 100;
            
            // Check if either value changed significantly
            const currentPrice = service.price || 0;
            const currentCost = service.cost || 0;
            const priceChanged = Math.abs(roundedPrice - currentPrice) > 0.01;
            const costChanged = Math.abs(roundedCost - currentCost) > 0.01;
            
            if (priceChanged || costChanged) {
              try {
                await stApi.updateService(service.id, { 
                  price: roundedPrice,
                  cost: roundedCost
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
      
      // Emit completion
      const successMessage = results.errors.length > 0 
        ? `Completed with ${results.errors.length} errors. Updated ${results.updated} of ${results.processed} services.`
        : `Successfully updated ${results.updated} of ${results.processed} services.`;
      emitProgress(tenantId, 'complete', successMessage, results.updated, results.processed);
      
      res.json(results);
    } catch (err: any) {
      // Emit error
      emitProgress(tenantId, 'error', `Push failed: ${err.message}`, 0, 0);
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}
