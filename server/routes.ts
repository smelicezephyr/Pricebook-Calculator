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
    
    try {
      const results = await processPush({
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
      }, tenant);
      
      // Update history with results
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
      
      res.json({ 
        ...results, 
        historyId,
        skipped: results.skipped,
      });
    } catch (err: any) {
      // Update history with failure
      await storage.updatePushHistory(historyId, {
        status: 'failed',
        completedAt: new Date(),
        errorMessages: JSON.stringify([err.message || 'Push failed']),
        errorCount: 1,
      });
      
      pushQueue.completePush(tenantId);
      emitProgress(tenantId, 'error', `Push failed: ${err.message}`, 0, 0);
      res.status(500).json({ message: err.message });
    }
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

  return httpServer;
}
