import { storage } from "./storage";
import { ServiceTitanAPI } from "./servicetitan";
import { pushProgressEmitter, emitProgress } from "./pushProgress";
import { pushQueue, withRetry } from "./pushQueue";
import type { PushHistory, Tenant } from "@shared/schema";
import { sendPushCompleteNotification } from "./email";

interface PushParams {
  tenantId: number;
  historyId: number;
  categoryIds: number[];
  targetMePercent: number;
  roundUp: boolean;
  salesTaxPercent: number;
  laborMode: string;
  laborPercent: number;
  laborHourlyRate: number;
  laborBurdenPercent: number;
  commissionPercent: number;
  commissionBurdenPercent: number;
  financingFeePercent: number;
  skipZeroEquipment?: boolean;
  zeroEquipmentSetZeroPrice?: boolean;
}

interface PushResult {
  processed: number;
  updated: number;
  skipped: number;
  errors: string[];
  cancelled?: boolean;
  originalValues: string | null;
}

export async function processPush(params: PushParams, tenant: Tenant): Promise<PushResult> {
  const {
    tenantId,
    historyId,
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
    skipZeroEquipment = false,
    zeroEquipmentSetZeroPrice = false,
  } = params;

  const salesTaxRate = salesTaxPercent / 100;
  const laborPercentRate = laborPercent / 100;
  const laborBurdenRate = laborBurdenPercent / 100;
  const commissionRate = commissionPercent / 100;
  const commissionBurdenRate = commissionBurdenPercent / 100;
  const financingRate = financingFeePercent / 100;

  console.log(`[Push] Starting push for tenant ${tenantId} (history ${historyId}), categories: [${categoryIds.join(', ')}], targetMePercent: ${targetMePercent}%, roundUp: ${roundUp}`);

  pushProgressEmitter.startPush(tenantId);
  pushProgressEmitter.startPhase(tenantId, 'services');
  emitProgress(tenantId, 'services', 'Starting push...', 0, 100);

  const stApi = new ServiceTitanAPI(tenant);
  const results: PushResult = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    originalValues: null,
  };

  try {
    console.log('[Push] Step 1: Fetching services for selected categories...');
    emitProgress(tenantId, 'services', 'Loading services from selected categories...', 0, categoryIds.length);

    const allServices: any[] = [];
    let servicesWithMaterials = 0;
    let servicesWithEquipment = 0;

    const selectedCategorySet = new Set(categoryIds);
    const seenServiceIds = new Set<number>();

    // Fetch the category tree to understand parent-child relationships
    // This lets us skip parent categories when their children are also selected,
    // since the ServiceTitan API's categoryId filter is hierarchical (includes children)
    let allCategoriesMap = new Map<number, { id: number; parentId?: number | null }>();
    try {
      const allCats = await stApi.getCategories();
      for (const cat of allCats) {
        allCategoriesMap.set(cat.id, { id: cat.id, parentId: cat.parentId });
      }
    } catch (err: any) {
      console.log(`[Push] Warning: Could not fetch category tree: ${err.message}`);
    }

    // Determine which categories to actually query:
    // Skip a selected category if ANY of its children are also selected,
    // because querying the parent would return those children's services too
    const categoriesToQuery: number[] = [];
    for (const catId of categoryIds) {
      // Check if any other selected category is a child of this one
      const hasSelectedChild = categoryIds.some(otherId => {
        if (otherId === catId) return false;
        // Walk up from otherId to see if it's a descendant of catId
        let current = allCategoriesMap.get(otherId);
        while (current && current.parentId) {
          if (current.parentId === catId) return true;
          current = allCategoriesMap.get(current.parentId);
        }
        return false;
      });
      if (!hasSelectedChild) {
        categoriesToQuery.push(catId);
      } else {
        console.log(`[Push] Skipping parent category ${catId} (has selected children)`);
      }
    }

    console.log(`[Push] Will query ${categoriesToQuery.length} leaf categories (from ${categoryIds.length} selected)`);

    for (let i = 0; i < categoriesToQuery.length; i++) {
      const categoryId = categoriesToQuery[i];
      try {
        console.log(`[Push] Fetching services for category ${categoryId}...`);
        const services = await stApi.getServices(categoryId);
        console.log(`[Push] Category ${categoryId}: found ${services.length} services`);
        
        // Debug: Log first service to see category fields
        if (i === 0 && services.length > 0) {
          const s = services[0];
          console.log(`[DEBUG] Sample service: id=${s.id}, categoryId=${s.categoryId}, categories=${JSON.stringify(s.categories)}`);
        }

        let addedCount = 0;
        for (const service of services) {
          // Deduplicate: skip services we've already added from another category query
          if (seenServiceIds.has(service.id)) {
            continue;
          }

          // Determine the service's actual category
          const serviceCatId = service.categoryId 
            || (service.categories && service.categories.length > 0 ? service.categories[0].id : null);

          // Only include services whose category exactly matches one of the selected categories
          // This prevents including services from unselected child/parent categories
          if (serviceCatId && !selectedCategorySet.has(serviceCatId)) {
            continue;
          }

          seenServiceIds.add(service.id);
          allServices.push(service);
          addedCount++;
          if (service.serviceMaterials && service.serviceMaterials.length > 0) {
            servicesWithMaterials++;
          }
          if (service.serviceEquipment && service.serviceEquipment.length > 0) {
            servicesWithEquipment++;
          }
        }

        console.log(`[Push] Category ${categoryId}: ${addedCount} services matched (filtered from ${services.length})`);
        emitProgress(tenantId, 'services', `Loaded ${allServices.length} services from ${i + 1}/${categoriesToQuery.length} categories`, i + 1, categoriesToQuery.length);
      } catch (err: any) {
        console.log(`[Push] Failed to fetch services for category ${categoryId}: ${err.message}`);
        results.errors.push(`Failed to fetch category ${categoryId}: ${err.message}`);
      }
    }

    console.log(`[Push] Total services found: ${allServices.length} (${servicesWithMaterials} with materials, ${servicesWithEquipment} with equipment)`);

    if (allServices.length === 0) {
      emitProgress(tenantId, 'complete', 'No services found in selected categories', 0, 0);
      return results;
    }

    console.log('[Push] Step 2: Fetching all materials (required for cost lookup)...');
    pushProgressEmitter.startPhase(tenantId, 'materials');
    emitProgress(tenantId, 'materials', 'Loading materials catalog...', 0, 100);
    const materialsStart = Date.now();
    let materialsPage = 0;
    const allMaterials = await stApi.getMaterials((page, count) => {
      materialsPage = page;
      // Show simple progress without confusing item counts
      emitProgress(tenantId, 'materials', `Loading materials catalog (page ${page})...`, page * 10, 100);
    });
    console.log(`[Push] Materials fetched in ${Date.now() - materialsStart}ms: ${allMaterials.length} items`);
    emitProgress(tenantId, 'materials', `Loaded ${allMaterials.length} materials`, 100, 100);

    console.log('[Push] Step 3: Fetching all equipment (required for cost lookup)...');
    pushProgressEmitter.startPhase(tenantId, 'equipment');
    emitProgress(tenantId, 'equipment', 'Loading equipment catalog...', 0, 100);
    const equipmentStart = Date.now();
    let equipmentPage = 0;
    const allEquipment = await stApi.getEquipment((page, count) => {
      equipmentPage = page;
      // Show simple progress without confusing item counts
      emitProgress(tenantId, 'equipment', `Loading equipment catalog (page ${page})...`, page * 10, 100);
    });
    console.log(`[Push] Equipment fetched in ${Date.now() - equipmentStart}ms: ${allEquipment.length} items`);
    emitProgress(tenantId, 'equipment', `Loaded ${allEquipment.length} equipment`, 100, 100);

    const materialCostMap = new Map<number, number>();
    for (const mat of allMaterials) {
      materialCostMap.set(mat.id, mat.cost || 0);
    }

    const equipmentCostMap = new Map<number, number>();
    for (const equip of allEquipment) {
      equipmentCostMap.set(equip.id, equip.cost || 0);
    }

    console.log(`[Push] Built cost maps: ${materialCostMap.size} materials, ${equipmentCostMap.size} equipment`);
    
    // Debug: Check if specific material IDs exist in the map (for service 54655766)
    const debugMaterialIds = [20129943, 178703978, 178846076, 178859067, 178859124, 178859580];
    for (const matId of debugMaterialIds) {
      const cost = materialCostMap.get(matId);
      console.log(`[DEBUG] Material ${matId} in cost map: ${cost !== undefined ? `$${cost}` : 'NOT FOUND'}`);
    }

    console.log('[Push] Step 4: Processing services...');
    const totalServices = allServices.length;
    pushProgressEmitter.startPhase(tenantId, 'updating');
    emitProgress(tenantId, 'updating', `Processing ${totalServices} services...`, 0, totalServices);

    const originalValues: Array<{ serviceId: number; originalPrice: number; originalCost: number }> = [];
    let wasCancelled = false;

    pushProgressEmitter.clearCancel(tenantId);

    console.log('[Push] Calculating price updates...');
    interface PendingUpdate {
      service: any;
      roundedPrice: number;
      roundedCost: number;
      currentPrice: number;
      currentCost: number;
    }
    const pendingUpdates: PendingUpdate[] = [];

    // Debug target service IDs
    const DEBUG_SERVICE_IDS = [54655766];
    
    for (const service of allServices) {
      if (results.processed % 50 === 0 && pushProgressEmitter.isCancelled(tenantId)) {
        wasCancelled = true;
        console.log(`[Push] Cancelled during calculation at service ${results.processed} of ${totalServices}`);
        break;
      }

      results.processed++;
      
      const isDebugService = DEBUG_SERVICE_IDS.includes(service.id);

      if (results.processed % 100 === 0 || results.processed === totalServices) {
        emitProgress(tenantId, 'updating', `Calculating ${results.processed} of ${totalServices} services...`, results.processed, totalServices);
      }
      
      // Debug: Log full structure for target service
      if (isDebugService) {
        console.log(`[DEBUG] Service ${service.id} full structure:`, JSON.stringify({
          id: service.id,
          name: service.name,
          price: service.price,
          cost: service.cost,
          materials: service.materials,
          equipment: service.equipment,
          serviceMaterials: service.serviceMaterials,
          serviceEquipment: service.serviceEquipment,
        }, null, 2));
      }

      let materialsCost = 0;
      let equipmentCost = 0;

      // First try embedded materials array (has cost directly)
      if (service.materials && service.materials.length > 0) {
        for (const mat of service.materials) {
          materialsCost += (mat.cost || 0) * (mat.quantity || 1);
        }
        if (isDebugService) {
          console.log(`[DEBUG] Service ${service.id}: Using embedded materials array, cost = $${materialsCost.toFixed(2)}`);
        }
      }
      // Fall back to serviceMaterials with skuId lookup
      else if (service.serviceMaterials && service.serviceMaterials.length > 0) {
        for (const mat of service.serviceMaterials) {
          const cost = materialCostMap.get(mat.skuId) || 0;
          materialsCost += cost * (mat.quantity || 1);
          if (isDebugService) {
            console.log(`[DEBUG] Service ${service.id}: serviceMaterial skuId=${mat.skuId}, qty=${mat.quantity}, lookupCost=${cost}`);
          }
        }
        if (isDebugService) {
          console.log(`[DEBUG] Service ${service.id}: Using serviceMaterials lookup, total = $${materialsCost.toFixed(2)}`);
        }
      } else if (isDebugService) {
        console.log(`[DEBUG] Service ${service.id}: No materials or serviceMaterials found`);
      }

      // First try embedded equipment array (has cost directly)
      if (service.equipment && service.equipment.length > 0) {
        for (const equip of service.equipment) {
          equipmentCost += (equip.cost || 0) * (equip.quantity || 1);
        }
        if (isDebugService) {
          console.log(`[DEBUG] Service ${service.id}: Using embedded equipment array, cost = $${equipmentCost.toFixed(2)}`);
        }
      }
      // Fall back to serviceEquipment with skuId lookup
      else if (service.serviceEquipment && service.serviceEquipment.length > 0) {
        for (const equip of service.serviceEquipment) {
          const cost = equipmentCostMap.get(equip.skuId) || 0;
          equipmentCost += cost * (equip.quantity || 1);
          if (isDebugService) {
            console.log(`[DEBUG] Service ${service.id}: serviceEquipment skuId=${equip.skuId}, qty=${equip.quantity}, lookupCost=${cost}`);
          }
        }
        if (isDebugService) {
          console.log(`[DEBUG] Service ${service.id}: Using serviceEquipment lookup, total = $${equipmentCost.toFixed(2)}`);
        }
      } else if (isDebugService) {
        console.log(`[DEBUG] Service ${service.id}: No equipment or serviceEquipment found`);
      }

      const rawMeCost = materialsCost + equipmentCost;
      
      if (isDebugService) {
        console.log(`[DEBUG] Service ${service.id}: rawMeCost = $${rawMeCost.toFixed(2)} (materials: $${materialsCost.toFixed(2)}, equipment: $${equipmentCost.toFixed(2)})`);
      }

      // Handle services where equipment cost = $0
      if (skipZeroEquipment && equipmentCost === 0) {
        if (zeroEquipmentSetZeroPrice) {
          // Actively push $0 as the static price for this service
          const currentPrice = service.price || 0;
          const currentCost = service.cost || 0;
          if (currentPrice !== 0) {
            pendingUpdates.push({ service, roundedPrice: 0, roundedCost: 0, currentPrice, currentCost });
          }
        } else {
          // Skip entirely
          if (results.skipped < 10) {
            console.log(`[Push] Skipping service ${service.id} (${service.name?.substring(0, 30)}): equipment = $0 (materials: $${materialsCost.toFixed(2)})`);
          } else if (results.skipped === 10) {
            console.log(`[Push] (Suppressing further skip logs...)`);
          }
          results.skipped++;
        }
        continue;
      }

      const tax = rawMeCost * salesTaxRate;
      const totalMe = rawMeCost + tax;
      const newPrice = totalMe / (targetMePercent / 100);

      let laborCost = 0;
      if (laborMode === 'hours') {
        const hours = service.hours || 0;
        laborCost = (hours * laborHourlyRate) * (1 + laborBurdenRate);
      } else {
        laborCost = (newPrice * laborPercentRate) * (1 + laborBurdenRate);
      }

      const commissionCost = (newPrice * commissionRate) * (1 + commissionBurdenRate);
      const financingCost = newPrice * financingRate;
      const estimatedLabor = laborCost + commissionCost + tax + financingCost;

      const roundedPrice = roundUp ? Math.ceil(newPrice) : Math.round(newPrice * 100) / 100;
      const roundedCost = Math.round(estimatedLabor * 100) / 100;

      const currentPrice = service.price || 0;
      const currentCost = service.cost || 0;
      const priceChanged = Math.abs(roundedPrice - currentPrice) > 0.01;
      const costChanged = Math.abs(roundedCost - currentCost) > 0.01;

      if (priceChanged || costChanged) {
        pendingUpdates.push({ service, roundedPrice, roundedCost, currentPrice, currentCost });
      }
    }

    console.log(`[Push] ${pendingUpdates.length} services need updates, ${results.skipped} skipped (no M&E)`);

    if (wasCancelled) {
      pushProgressEmitter.clearCancel(tenantId);
      console.log(`[Push] Cancelled during calculation phase`);
      emitProgress(tenantId, 'cancelled', `Push cancelled during calculation. No services were updated.`, 0, totalServices);
      results.cancelled = true;
      return results;
    }

    const CONCURRENCY = 50;
    let completedUpdates = 0;

    emitProgress(tenantId, 'updating', `Updating ${pendingUpdates.length} services (${CONCURRENCY} at a time)...`, 0, pendingUpdates.length);

    for (let i = 0; i < pendingUpdates.length; i += CONCURRENCY) {
      if (pushProgressEmitter.isCancelled(tenantId)) {
        wasCancelled = true;
        console.log(`[Push] Cancelled at batch ${Math.floor(i / CONCURRENCY) + 1}`);
        break;
      }

      const batch = pendingUpdates.slice(i, i + CONCURRENCY);

      const batchResults = await Promise.allSettled(
        batch.map(async (update) => {
          const originalEntry = {
            serviceId: update.service.id,
            serviceName: update.service.name ?? "",
            originalPrice: update.currentPrice,
            originalCost: update.currentCost,
            newPrice: update.roundedPrice,
          };

          // Note: ServiceTitan's 'cost' field (Estimated Labor Cost) is calculated internally
          // based on Hours and their labor rate settings - it cannot be updated via API.
          // We only update 'price' (Static Price) which is what the M&E calculation targets.
          await withRetry(
            () => stApi.updateService(update.service.id, {
              price: update.roundedPrice
            }),
            3,
            1000
          );

          return { success: true, originalEntry, update };
        })
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.updated++;
          originalValues.push(result.value.originalEntry);

          if (results.updated <= 3) {
            const u = result.value.update;
            console.log(`[Push] Updated service "${u.service.name}": price $${u.currentPrice} -> $${u.roundedPrice}`);
          }
        } else {
          results.errors.push(`Failed to update service: ${result.reason?.message || 'Unknown error'}`);
        }
      }

      completedUpdates = Math.min(i + CONCURRENCY, pendingUpdates.length);
      emitProgress(tenantId, 'updating', `Updated ${completedUpdates} of ${pendingUpdates.length} services...`, completedUpdates, pendingUpdates.length);
    }

    pushProgressEmitter.clearCancel(tenantId);

    if (wasCancelled) {
      console.log(`[Push] Cancelled: ${results.processed} processed, ${results.updated} updated before cancellation`);
      emitProgress(tenantId, 'cancelled', `Push cancelled. Updated ${results.updated} services before stopping.`, results.updated, totalServices);
      results.cancelled = true;
      results.originalValues = originalValues.length > 0 ? JSON.stringify(originalValues) : null;
      return results;
    }

    console.log(`[Push] Completed: ${results.processed} processed, ${results.updated} updated, ${results.skipped} skipped (no M&E), ${results.errors.length} errors`);

    const successMessage = results.errors.length > 0
      ? `Completed with ${results.errors.length} errors. Updated ${results.updated} of ${results.processed} services (${results.skipped} skipped - no M&E).`
      : `Successfully updated ${results.updated} of ${results.processed} services (${results.skipped} skipped - no M&E).`;
    emitProgress(tenantId, 'complete', successMessage, results.updated, results.processed);

    results.originalValues = originalValues.length > 0 ? JSON.stringify(originalValues) : null;
    return results;

  } catch (err: any) {
    emitProgress(tenantId, 'error', `Push failed: ${err.message}`, 0, 0);
    throw err;
  }
}

// ─── Repair Push ──────────────────────────────────────────────────────────────

interface RepairPushParams {
  tenantId: number;
  historyId: number;
  categoryIds: number[];
  materialMarkupPercent: number;
  salesTaxPercent: number;
  laborMode: string;
  laborHourlyRate: number;
  laborHours: number;
  laborBurdenPercent: number;
  commissionPercent: number;
  commissionBurdenPercent: number;
  financingFeePercent: number;
  roundUp: boolean;
  skipNoMaterials?: boolean;
}

export async function processRepairPush(params: RepairPushParams, tenant: Tenant): Promise<PushResult> {
  const {
    tenantId,
    historyId,
    categoryIds,
    materialMarkupPercent,
    salesTaxPercent,
    laborMode,
    laborHourlyRate,
    laborHours: fixedLaborHours,
    laborBurdenPercent,
    commissionPercent,
    financingFeePercent,
    roundUp,
    skipNoMaterials = false,
  } = params;

  const markupRate = materialMarkupPercent / 100;
  const taxRate = salesTaxPercent / 100;
  const burdenRate = laborBurdenPercent / 100;
  const commissionRate = commissionPercent / 100;
  const financingRate = financingFeePercent / 100;

  console.log(`[RepairPush] Starting for tenant ${tenantId} (history ${historyId}), markup: ${materialMarkupPercent}%, laborMode: ${laborMode}, skipNoMaterials: ${skipNoMaterials}`);

  pushProgressEmitter.startPush(tenantId);
  pushProgressEmitter.startPhase(tenantId, 'services');
  emitProgress(tenantId, 'services', 'Starting repair push...', 0, 100);

  const stApi = new ServiceTitanAPI(tenant);
  const results: PushResult = { processed: 0, updated: 0, skipped: 0, errors: [], originalValues: null };

  try {
    emitProgress(tenantId, 'services', 'Loading services from selected categories...', 0, categoryIds.length);

    const allServices: any[] = [];
    const selectedCategorySet = new Set(categoryIds);
    const seenServiceIds = new Set<number>();

    let allCategoriesMap = new Map<number, { id: number; parentId?: number | null }>();
    try {
      const allCats = await stApi.getCategories();
      for (const cat of allCats) allCategoriesMap.set(cat.id, { id: cat.id, parentId: cat.parentId });
    } catch (err: any) {
      console.log(`[RepairPush] Warning: Could not fetch category tree: ${err.message}`);
    }

    const categoriesToQuery: number[] = [];
    for (const catId of categoryIds) {
      const hasSelectedChild = categoryIds.some(otherId => {
        if (otherId === catId) return false;
        let current = allCategoriesMap.get(otherId);
        while (current && current.parentId) {
          if (current.parentId === catId) return true;
          current = allCategoriesMap.get(current.parentId);
        }
        return false;
      });
      if (!hasSelectedChild) categoriesToQuery.push(catId);
    }

    for (let i = 0; i < categoriesToQuery.length; i++) {
      const categoryId = categoriesToQuery[i];
      try {
        const services = await stApi.getServices(categoryId);
        for (const service of services) {
          if (seenServiceIds.has(service.id)) continue;
          const serviceCatId = service.categoryId
            || (service.categories && service.categories.length > 0 ? service.categories[0].id : null);
          if (serviceCatId && !selectedCategorySet.has(serviceCatId)) continue;
          seenServiceIds.add(service.id);
          allServices.push(service);
        }
        emitProgress(tenantId, 'services', `Loaded ${allServices.length} services from ${i + 1}/${categoriesToQuery.length} categories`, i + 1, categoriesToQuery.length);
      } catch (err: any) {
        results.errors.push(`Failed to fetch category ${categoryId}: ${err.message}`);
      }
    }

    if (allServices.length === 0) {
      emitProgress(tenantId, 'complete', 'No services found in selected categories', 0, 0);
      return results;
    }

    pushProgressEmitter.startPhase(tenantId, 'materials');
    emitProgress(tenantId, 'materials', 'Loading materials catalog...', 0, 100);
    const allMaterials = await stApi.getMaterials((page) => {
      emitProgress(tenantId, 'materials', `Loading materials catalog (page ${page})...`, page * 10, 100);
    });
    emitProgress(tenantId, 'materials', `Loaded ${allMaterials.length} materials`, 100, 100);

    pushProgressEmitter.startPhase(tenantId, 'equipment');
    emitProgress(tenantId, 'equipment', 'Loading equipment catalog...', 0, 100);
    const allEquipment = await stApi.getEquipment((page) => {
      emitProgress(tenantId, 'equipment', `Loading equipment catalog (page ${page})...`, page * 10, 100);
    });
    emitProgress(tenantId, 'equipment', `Loaded ${allEquipment.length} equipment`, 100, 100);

    const materialCostMap = new Map<number, number>();
    for (const mat of allMaterials) materialCostMap.set(mat.id, mat.cost || 0);
    const equipmentCostMap = new Map<number, number>();
    for (const equip of allEquipment) equipmentCostMap.set(equip.id, equip.cost || 0);

    const totalServices = allServices.length;
    pushProgressEmitter.startPhase(tenantId, 'updating');
    emitProgress(tenantId, 'updating', `Processing ${totalServices} services...`, 0, totalServices);

    const originalValues: Array<{ serviceId: number; serviceName?: string; originalPrice: number; originalCost: number; newPrice?: number }> = [];
    let wasCancelled = false;
    pushProgressEmitter.clearCancel(tenantId);

    interface PendingRepairUpdate {
      service: any;
      roundedPrice: number;
      currentPrice: number;
      currentCost: number;
    }
    const pendingUpdates: PendingRepairUpdate[] = [];

    for (const service of allServices) {
      if (results.processed % 50 === 0 && pushProgressEmitter.isCancelled(tenantId)) {
        wasCancelled = true;
        break;
      }

      results.processed++;

      if (results.processed % 100 === 0 || results.processed === totalServices) {
        emitProgress(tenantId, 'updating', `Calculating ${results.processed} of ${totalServices} services...`, results.processed, totalServices);
      }

      let materialsCost = 0;
      let equipmentCost = 0;

      if (service.materials && service.materials.length > 0) {
        for (const mat of service.materials) materialsCost += (mat.cost || 0) * (mat.quantity || 1);
      } else if (service.serviceMaterials && service.serviceMaterials.length > 0) {
        for (const mat of service.serviceMaterials) materialsCost += (materialCostMap.get(mat.skuId) || 0) * (mat.quantity || 1);
      }

      if (service.equipment && service.equipment.length > 0) {
        for (const equip of service.equipment) equipmentCost += (equip.cost || 0) * (equip.quantity || 1);
      } else if (service.serviceEquipment && service.serviceEquipment.length > 0) {
        for (const equip of service.serviceEquipment) equipmentCost += (equipmentCostMap.get(equip.skuId) || 0) * (equip.quantity || 1);
      }

      const rawParts = materialsCost + equipmentCost;

      if (skipNoMaterials && rawParts === 0) {
        results.skipped++;
        continue;
      }

      // Repair calculator formula — matches RepairCalculator.tsx exactly
      const salesTax = rawParts * taxRate;
      const subtotal1 = rawParts + salesTax;
      const subtotal2 = subtotal1 + subtotal1 * markupRate;

      let subtotal3: number;
      if (laborMode === 'hours') {
        const burdenedLabor = fixedLaborHours * laborHourlyRate * (1 + burdenRate);
        subtotal3 = subtotal2 + burdenedLabor;
      } else {
        subtotal3 = subtotal2;
      }

      // Same denominator as RepairCalculator.tsx: burden applies to both labor and commission
      const denominator = 1 - commissionRate * (1 + burdenRate) - financingRate;
      const totalPrice = denominator > 0 ? subtotal3 / denominator : subtotal3;
      const roundedPrice = roundUp ? Math.ceil(totalPrice) : Math.round(totalPrice * 100) / 100;

      const currentPrice = service.price || 0;
      if (Math.abs(roundedPrice - currentPrice) > 0.01) {
        pendingUpdates.push({ service, roundedPrice, currentPrice, currentCost: service.cost || 0 });
      }
    }

    if (wasCancelled) {
      pushProgressEmitter.clearCancel(tenantId);
      emitProgress(tenantId, 'cancelled', 'Push cancelled during calculation. No services were updated.', 0, totalServices);
      results.cancelled = true;
      return results;
    }

    const CONCURRENCY = 50;
    emitProgress(tenantId, 'updating', `Updating ${pendingUpdates.length} services (${CONCURRENCY} at a time)...`, 0, pendingUpdates.length);

    for (let i = 0; i < pendingUpdates.length; i += CONCURRENCY) {
      if (pushProgressEmitter.isCancelled(tenantId)) {
        wasCancelled = true;
        break;
      }

      const batch = pendingUpdates.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map(async (update) => {
          await withRetry(() => stApi.updateService(update.service.id, { price: update.roundedPrice }), 3, 1000);
          return update;
        })
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          const u = result.value;
          results.updated++;
          originalValues.push({ serviceId: u.service.id, serviceName: u.service.name ?? '', originalPrice: u.currentPrice, originalCost: u.currentCost, newPrice: u.roundedPrice });
        } else {
          results.errors.push(`Failed to update service: ${result.reason?.message || 'Unknown error'}`);
        }
      }

      emitProgress(tenantId, 'updating', `Updated ${Math.min(i + CONCURRENCY, pendingUpdates.length)} of ${pendingUpdates.length} services...`, Math.min(i + CONCURRENCY, pendingUpdates.length), pendingUpdates.length);
    }

    pushProgressEmitter.clearCancel(tenantId);

    if (wasCancelled) {
      emitProgress(tenantId, 'cancelled', `Push cancelled. Updated ${results.updated} services before stopping.`, results.updated, totalServices);
      results.cancelled = true;
      results.originalValues = originalValues.length > 0 ? JSON.stringify(originalValues) : null;
      return results;
    }

    const msg = results.errors.length > 0
      ? `Completed with ${results.errors.length} errors. Updated ${results.updated} of ${results.processed} services (${results.skipped} skipped).`
      : `Successfully updated ${results.updated} of ${results.processed} services (${results.skipped} skipped).`;
    emitProgress(tenantId, 'complete', msg, results.updated, results.processed);

    results.originalValues = originalValues.length > 0 ? JSON.stringify(originalValues) : null;
    return results;

  } catch (err: any) {
    emitProgress(tenantId, 'error', `Repair push failed: ${err.message}`, 0, 0);
    throw err;
  }
}

// ─── Queue helpers ─────────────────────────────────────────────────────────────

/** Transient options stored at queue-time so processQueuedPush can use them later. */
export const pendingPushExtras = new Map<number, { skipZeroEquipment: boolean; zeroEquipmentSetZeroPrice: boolean }>();

export async function processQueuedPush(historyId: number): Promise<void> {
  const historyItem = await storage.getPushHistoryItem(historyId);
  if (!historyItem) {
    console.log(`[PushQueue] History item ${historyId} not found`);
    return;
  }

  if (historyItem.status !== 'pending') {
    console.log(`[PushQueue] History item ${historyId} is not pending (status: ${historyItem.status})`);
    return;
  }

  const tenant = await storage.getTenant(historyItem.tenantId);
  if (!tenant) {
    console.log(`[PushQueue] Tenant ${historyItem.tenantId} not found`);
    await storage.updatePushHistory(historyId, {
      status: 'failed',
      completedAt: new Date(),
      errorMessages: JSON.stringify(['Tenant not found']),
      errorCount: 1,
    });
    pushQueue.completePush(historyItem.tenantId);
    return;
  }

  if (!pushQueue.startPush(historyItem.tenantId, historyId)) {
    console.log(`[PushQueue] Could not start push for tenant ${historyItem.tenantId} (already active or queue full)`);
    return;
  }

  await storage.updatePushHistory(historyId, {
    status: 'in_progress',
    startedAt: new Date(),
  });

  const categoryIds = JSON.parse(historyItem.categoryIds || '[]');
  const extras = pendingPushExtras.get(historyId);

  try {
    const isRepairPush = historyItem.pushType === 'update_repair';

    const results = isRepairPush
      ? await processRepairPush({
          tenantId: historyItem.tenantId,
          historyId,
          categoryIds,
          materialMarkupPercent: parseFloat(historyItem.targetMePercent), // repurposed column
          salesTaxPercent: parseFloat(historyItem.salesTaxPercent),
          laborMode: historyItem.laborMode,
          laborHourlyRate: parseFloat(historyItem.laborHourlyRate),
          laborHours: parseFloat(historyItem.laborHours ?? '1'),
          laborBurdenPercent: parseFloat(historyItem.laborBurdenPercent),
          commissionPercent: parseFloat(historyItem.commissionPercent),
          commissionBurdenPercent: parseFloat(historyItem.commissionBurdenPercent),
          financingFeePercent: parseFloat(historyItem.financingFeePercent),
          roundUp: historyItem.roundUp,
          skipNoMaterials: extras?.skipZeroEquipment ?? false,
        }, tenant)
      : await processPush({
          tenantId: historyItem.tenantId,
          historyId,
          categoryIds,
          targetMePercent: parseFloat(historyItem.targetMePercent),
          roundUp: historyItem.roundUp,
          salesTaxPercent: parseFloat(historyItem.salesTaxPercent),
          laborMode: historyItem.laborMode,
          laborPercent: parseFloat(historyItem.laborPercent),
          laborHourlyRate: parseFloat(historyItem.laborHourlyRate),
          laborBurdenPercent: parseFloat(historyItem.laborBurdenPercent),
          commissionPercent: parseFloat(historyItem.commissionPercent),
          commissionBurdenPercent: parseFloat(historyItem.commissionBurdenPercent),
          financingFeePercent: parseFloat(historyItem.financingFeePercent),
          skipZeroEquipment: extras?.skipZeroEquipment ?? false,
          zeroEquipmentSetZeroPrice: extras?.zeroEquipmentSetZeroPrice ?? false,
        }, tenant);
    pendingPushExtras.delete(historyId);

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

    // Email opted-in admins (fire-and-forget)
    storage.getAdminEmailSubscribers().then(subscribers => {
      if (subscribers.length > 0) {
        sendPushCompleteNotification(subscribers.map(u => ({ email: u.email, name: u.name })), {
          tenantName: tenant.name,
          pushedByName: historyItem.pushedByName ?? 'Unknown',
          status: finalStatus,
          processedCount: results.processed,
          updatedCount: results.updated,
          skippedCount: results.skipped,
          errorCount: results.errors.length,
        }).catch(e => console.error('[PushQueue] Email notification failed:', e));
      }
    }).catch(() => {});

  } catch (err: any) {
    console.error(`[PushQueue] Push failed for history ${historyId}:`, err);
    await storage.updatePushHistory(historyId, {
      status: 'failed',
      completedAt: new Date(),
      errorMessages: JSON.stringify([err.message || 'Push failed']),
      errorCount: 1,
    });
  } finally {
    pushQueue.completePush(historyItem.tenantId);
  }
}

pushQueue.on('ready', async ({ tenantId, historyId }) => {
  console.log(`[PushQueue] Ready event received for tenant ${tenantId}, history ${historyId}`);
  try {
    await processQueuedPush(historyId);
  } catch (err) {
    console.error(`[PushQueue] Error processing queued push:`, err);
    pushQueue.completePush(tenantId);
  }
});
