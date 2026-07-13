import type { Tenant } from "@shared/schema";

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface PricebookCategory {
  id: number;
  name: string;
  active: boolean;
  parentId?: number | null;
  subcategories?: PricebookCategory[];
  level?: number;
  categoryType?: string;
  position?: number;   // Primary ST sort field (confirmed from API responses)
  displayOrder?: number;
  sortOrder?: number;
  apiOrder?: number; // Sibling index stamped from the ST API's return order (fallback)
  [key: string]: any; // Allow additional fields from API
}

interface PricebookService {
  id: number;
  name?: string;
  displayName?: string;
  code: string;
  description?: string;
  price?: number;
  memberPrice?: number;
  addOnPrice?: number;
  cost?: number; // Estimated Labor Cost field in ServiceTitan
  hours?: number; // Hours field in ServiceTitan
  active: boolean;
  categoryId?: number;
  categories?: Array<{ id: number; name?: string }>;
  warranty?: { duration?: number; description?: string | null };
  serviceMaterials?: Array<{
    skuId: number;
    quantity: number;
  }>;
  serviceEquipment?: Array<{
    skuId: number;
    quantity: number;
  }>;
  materials?: Array<{
    id: number;
    name: string;
    cost: number;
    quantity: number;
  }>;
  equipment?: Array<{
    id: number;
    name: string;
    cost: number;
    quantity: number;
  }>;
}

interface PricebookVendorSubAccount {
  id?: number;
  cost?: number;
  accountName?: string;
}

interface PricebookVendor {
  id?: number;
  vendorName?: string;
  cost?: number;
  primarySubAccount?: PricebookVendorSubAccount;
}

interface PricebookMaterial {
  id: number;
  name: string;
  code: string;
  cost: number;
  price: number;
  active: boolean;
  categoryId?: number;
  primaryVendor?: PricebookVendor;
}

interface PricebookEquipment {
  id: number;
  name: string;
  code: string;
  cost: number;
  price: number;
  active: boolean;
  categoryId?: number;
  primaryVendor?: PricebookVendor;
  // Linked materials on the equipment catalog item (returned when expand=materials is used)
  equipmentMaterials?: Array<{ skuId: number; quantity: number }>;
  materials?: Array<{ id: number; name?: string; cost: number; quantity: number }>;
}

const tokenCache: Map<number, { token: string; expiresAt: number }> = new Map();

export class ServiceTitanAPI {
  private tenant: Tenant;
  private baseUrl = "https://api.servicetitan.io";
  private authUrl = "https://auth.servicetitan.io/connect/token";

  constructor(tenant: Tenant) {
    this.tenant = tenant;
  }

  async getAccessToken(): Promise<string> {
    const cached = tokenCache.get(this.tenant.id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    const response = await fetch(this.authUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.tenant.clientId,
        client_secret: this.tenant.clientSecret,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to authenticate with ServiceTitan: ${error}`);
    }

    const data: TokenResponse = await response.json();
    const expiresAt = Date.now() + (data.expires_in - 60) * 1000;
    
    tokenCache.set(this.tenant.id, {
      token: data.access_token,
      expiresAt,
    });

    return data.access_token;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = await this.getAccessToken();
    
    // Add 30 second timeout for API requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "ST-App-Key": this.tenant.appKey,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        let friendlyMessage = `ServiceTitan API error (${response.status})`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.title) {
            friendlyMessage = errorJson.title;
          } else if (errorJson.RawException) {
            const rawEx = errorJson.RawException;
            const match = rawEx.match(/^([^\.]+\.?\s*)/);
            friendlyMessage = match ? match[1].trim() : rawEx.substring(0, 200);
          } else if (errorJson.message) {
            friendlyMessage = errorJson.message;
          } else if (errorJson.detail) {
            friendlyMessage = errorJson.detail;
          }
          if (errorJson.errors && typeof errorJson.errors === 'object') {
            const fieldErrors = Object.entries(errorJson.errors)
              .map(([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs.join(', ') : msgs}`)
              .join('; ');
            if (fieldErrors) {
              friendlyMessage += ` - ${fieldErrors}`;
            }
          }
        } catch {
          if (errorText.length > 300) {
            friendlyMessage += `: ${errorText.substring(0, 300)}...`;
          } else {
            friendlyMessage += `: ${errorText}`;
          }
        }
        console.error(`[ServiceTitan] API error ${response.status} on ${endpoint}: ${errorText.substring(0, 500)}`);
        throw new Error(friendlyMessage);
      }

      return response.json();
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error(`ServiceTitan API timeout after 30s: ${endpoint}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async testConnection(): Promise<void> {
    // This will throw with a detailed error if authentication fails
    await this.getAccessToken();
  }

  async getCategories(): Promise<PricebookCategory[]> {
    const allCategories: PricebookCategory[] = [];
    let page = 1;
    let hasMore = true;
    
    while (hasMore) {
      const response = await this.request<{ 
        data: PricebookCategory[]; 
        page: number;
        pageSize: number;
        totalCount: number;
        hasMore: boolean;
      }>(
        `/pricebook/v2/tenant/${this.tenant.tenantId}/categories?pageSize=500&page=${page}`
      );
      
      console.log(`[ServiceTitan] Page ${page}: fetched ${response.data.length} categories, hasMore: ${response.hasMore}`);
      
      // Flatten categories - ServiceTitan returns nested subcategories
      let topLevelOrder = 0;
      for (const category of response.data) {
        // Skip inactive top-level categories
        if (category.active === false) continue;
        // Skip non-service categories (e.g. Materials)
        if (category.categoryType && category.categoryType !== "Services") continue;
        // Stamp apiOrder = position within this sibling group so the frontend
        // can sort by the ST API's natural return order when sortOrder/displayOrder
        // are absent or all zero.
        allCategories.push({ ...category, apiOrder: topLevelOrder++ });
        // Recursively add all nested subcategories
        this.flattenSubcategories(category, allCategories);
      }
      
      hasMore = response.hasMore;
      page++;
      
      // Safety limit to prevent infinite loops
      if (page > 50) break;
    }
    
    console.log(`[ServiceTitan] Total categories (including subcategories): ${allCategories.length}`);
    // Log sort-related fields so we can determine which to use for ordering
    console.log(`[ServiceTitan] Category sort fields (first 15):`, allCategories.slice(0, 15).map(c => ({
      id: c.id, name: c.name, parentId: c.parentId ?? null,
      sortOrder: c.sortOrder, displayOrder: c.displayOrder, order: c.order,
      position: c.position, rank: c.rank, index: c.index, apiOrder: c.apiOrder
    })));
    return allCategories;
  }
  
  private flattenSubcategories(category: PricebookCategory, result: PricebookCategory[]): void {
    if (category.subcategories && Array.isArray(category.subcategories)) {
      let siblingOrder = 0;
      for (const sub of category.subcategories) {
        // Skip inactive subcategories; if 'active' is absent on the nested object,
        // treat it as active (inherit from parent which was already confirmed active).
        if (sub.active === false) continue;
        // Skip non-service category types (e.g. Materials)
        if (sub.categoryType && sub.categoryType !== "Services") continue;
        // Stamp parentId so the frontend hierarchy builder can reconstruct the tree.
        // Also ensure 'active' is explicitly set so downstream filters work correctly.
        // apiOrder = position within this parent's subcategory list (ST's return order).
        const withParent: PricebookCategory = { ...sub, parentId: category.id, active: true, apiOrder: siblingOrder++ };
        result.push(withParent);
        // Recurse with the stamped copy so deeper children also get correct parentId
        this.flattenSubcategories(withParent, result);
      }
    }
  }

  async getServices(categoryId?: number): Promise<PricebookService[]> {
    const allServices: PricebookService[] = [];
    let page = 1;
    let hasMore = true;
    
    while (hasMore) {
      let url = `/pricebook/v2/tenant/${this.tenant.tenantId}/services?pageSize=500&page=${page}&expand=materials,equipment`;
      if (categoryId) {
        url += `&categoryId=${categoryId}`;
      }
      const response = await this.request<{ data: PricebookService[]; hasMore: boolean }>(url);
      allServices.push(...response.data);
      hasMore = response.hasMore;
      page++;
    }
    
    return allServices;
  }

  async getServiceById(serviceId: number): Promise<any> {
    // Get a single service with all details for diagnostics
    const url = `/pricebook/v2/tenant/${this.tenant.tenantId}/services/${serviceId}`;
    const response = await this.request<any>(url);
    return response;
  }

  async getMaterialById(materialId: number): Promise<any> {
    // Get a single material for diagnostics
    const url = `/pricebook/v2/tenant/${this.tenant.tenantId}/materials/${materialId}`;
    const response = await this.request<any>(url);
    return response;
  }

  async getMaterials(onProgress?: (page: number, count: number) => void): Promise<PricebookMaterial[]> {
    const allMaterials: PricebookMaterial[] = [];
    let page = 1;
    let hasMore = true;
    
    console.log(`[ServiceTitan] Starting materials fetch (all categories)...`);
    
    while (hasMore) {
      const url = `/pricebook/v2/tenant/${this.tenant.tenantId}/materials?pageSize=500&page=${page}`;
      console.log(`[ServiceTitan] Fetching materials page ${page}...`);
      const response = await this.request<{ 
        data: PricebookMaterial[]; 
        hasMore: boolean;
      }>(url);
      
      console.log(`[ServiceTitan] Materials page ${page}: got ${response.data.length} items, hasMore: ${response.hasMore}`);
      allMaterials.push(...response.data);
      hasMore = response.hasMore;
      
      // Report progress
      if (onProgress) {
        onProgress(page, allMaterials.length);
      }
      
      page++;
      
      if (page > 50) {
        console.log(`[ServiceTitan] Hit materials safety limit at page 50`);
        break;
      }
    }
    
    console.log(`[ServiceTitan] Finished materials fetch: ${allMaterials.length} total items`);
    return allMaterials;
  }

  async getEquipment(onProgress?: (page: number, count: number) => void): Promise<PricebookEquipment[]> {
    const allEquipment: PricebookEquipment[] = [];
    let page = 1;
    let hasMore = true;
    
    console.log(`[ServiceTitan] Starting equipment fetch (all categories)...`);
    
    while (hasMore) {
      const url = `/pricebook/v2/tenant/${this.tenant.tenantId}/equipment?pageSize=500&page=${page}&expand=materials`;
      console.log(`[ServiceTitan] Fetching equipment page ${page}...`);
      const response = await this.request<{ 
        data: PricebookEquipment[]; 
        hasMore: boolean;
      }>(url);
      
      console.log(`[ServiceTitan] Equipment page ${page}: got ${response.data.length} items, hasMore: ${response.hasMore}`);
      allEquipment.push(...response.data);
      hasMore = response.hasMore;
      
      // Report progress
      if (onProgress) {
        onProgress(page, allEquipment.length);
      }
      
      page++;
      
      if (page > 50) {
        console.log(`[ServiceTitan] Hit equipment safety limit at page 50`);
        break;
      }
    }
    
    console.log(`[ServiceTitan] Finished equipment fetch: ${allEquipment.length} total items`);
    return allEquipment;
  }

  async updateService(
    serviceId: number,
    updates: { price?: number; memberPrice?: number; cost?: number }
  ): Promise<PricebookService> {
    console.log(`[ServiceTitan] Updating service ${serviceId} with:`, JSON.stringify(updates));
    const result = await this.request<PricebookService>(
      `/pricebook/v2/tenant/${this.tenant.tenantId}/services/${serviceId}`,
      {
        method: "PATCH",
        body: JSON.stringify(updates),
      }
    );
    console.log(`[ServiceTitan] Update response - price: ${result.price}, cost: ${result.cost}`);
    return result;
  }

  async updateMaterial(
    materialId: number,
    updates: { price?: number }
  ): Promise<PricebookMaterial> {
    return this.request<PricebookMaterial>(
      `/pricebook/v2/tenant/${this.tenant.tenantId}/materials/${materialId}`,
      {
        method: "PATCH",
        body: JSON.stringify(updates),
      }
    );
  }

  async updateEquipment(
    equipmentId: number,
    updates: { price?: number }
  ): Promise<PricebookEquipment> {
    return this.request<PricebookEquipment>(
      `/pricebook/v2/tenant/${this.tenant.tenantId}/equipment/${equipmentId}`,
      {
        method: "PATCH",
        body: JSON.stringify(updates),
      }
    );
  }

  async getGLAccounts(): Promise<GLAccount[]> {
    // Use Pricebook accounts endpoint instead of accounting GL accounts
    // The Pricebook API requires account IDs from this endpoint, not accounting GL accounts
    const allAccounts: GLAccount[] = [];
    let page = 1;
    let hasMore = true;
    
    console.log(`[ServiceTitan] Starting Pricebook accounts fetch...`);
    
    while (hasMore) {
      const url = `/pricebook/v2/tenant/${this.tenant.tenantId}/accounts?pageSize=500&page=${page}`;
      const response = await this.request<{ 
        data: Array<{
          id: number;
          name: string;
          number: string | null;
          type: string;
          active: boolean;
        }>; 
        hasMore: boolean;
      }>(url);
      
      console.log(`[ServiceTitan] Pricebook accounts page ${page}: got ${response.data.length} items, hasMore: ${response.hasMore}`);
      
      // Map Pricebook accounts to GLAccount format
      const mappedAccounts: GLAccount[] = response.data.map(acc => ({
        id: acc.id,
        name: acc.name,
        number: acc.number ?? undefined,
        type: acc.type,
        active: acc.active,
      }));
      
      allAccounts.push(...mappedAccounts);
      hasMore = response.hasMore;
      page++;
      
      if (page > 20) {
        console.log(`[ServiceTitan] Hit Pricebook accounts safety limit at page 20`);
        break;
      }
    }
    
    console.log(`[ServiceTitan] Finished Pricebook accounts fetch: ${allAccounts.length} total items`);
    return allAccounts;
  }

  async createService(serviceData: CreateServiceRequest): Promise<PricebookService> {
    const payload: Record<string, any> = {
      code: serviceData.code,
      displayName: serviceData.displayName,
      active: serviceData.active ?? true,
    };

    if (serviceData.description) payload.description = serviceData.description;
    if (serviceData.warranty && serviceData.warranty.description) {
      payload.warranty = serviceData.warranty;
    }
    if (typeof serviceData.taxable === 'boolean') payload.taxable = serviceData.taxable;
    if (typeof serviceData.price === 'number' && !isNaN(serviceData.price)) payload.price = serviceData.price;
    if (typeof serviceData.memberPrice === 'number' && !isNaN(serviceData.memberPrice)) payload.memberPrice = serviceData.memberPrice;
    if (typeof serviceData.hours === 'number' && !isNaN(serviceData.hours)) payload.hours = serviceData.hours;
    if (serviceData.categories && serviceData.categories.length > 0) payload.categories = serviceData.categories;
    if (serviceData.account) payload.account = serviceData.account;
    if (typeof serviceData.allowDiscountCodes === 'boolean') payload.allowDiscountCodes = serviceData.allowDiscountCodes;
    if (typeof serviceData.allowMembershipDiscounts === 'boolean') payload.allowMembershipDiscounts = serviceData.allowMembershipDiscounts;

    console.log(`[ServiceTitan] Creating new service:`, JSON.stringify(payload));
    const result = await this.request<PricebookService>(
      `/pricebook/v2/tenant/${this.tenant.tenantId}/services`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
    console.log(`[ServiceTitan] Created service - id: ${result.id}, displayName: ${result.displayName}, price: ${result.price}`);
    return result;
  }

  /**
   * Fetch the highest hourly pay rate among all technicians.
   * Flow:
   *   1. GET /payroll/v2/tenant/{tenantId}/technicians  — list all technicians
   *   2. GET /payroll/v2/tenant/{tenantId}/technicians/{id}/payroll-settings  — per-tech hourlyRate
   * Returns the highest hourlyRate found across all technicians.
   */
  async getHighestTechnicianRate(): Promise<{
    rate: number;
    technicianName: string;
    technicianCount: number;
  }> {
    // Step 1: collect technician IDs from Payroll module records.
    // The Payroll API doesn't have a plain /technicians list endpoint, but
    // "Technician Payrolls" and "Payroll Jobs" records each carry technicianId.
    const techIdMap = new Map<number, string>(); // id → display name

    // Try every known path that lists technicians/employees across ST modules.
    // These need the corresponding module enabled in the ST developer app.
    const payrollSources = [
      // Settings module (v2 & v1)
      `/settings/v2/tenant/${this.tenant.tenantId}/technicians`,
      `/settings/v2/tenant/${this.tenant.tenantId}/employees`,
      `/settings/v1/tenant/${this.tenant.tenantId}/technicians`,
      `/settings/v1/tenant/${this.tenant.tenantId}/employees`,
      // HRM module
      `/hrm/v2/tenant/${this.tenant.tenantId}/employees`,
      `/hrm/v2/tenant/${this.tenant.tenantId}/technicians`,
      // Dispatch module
      `/dispatch/v2/tenant/${this.tenant.tenantId}/technicians`,
      // JPM module
      `/jpm/v2/tenant/${this.tenant.tenantId}/technicians`,
      // CRM module
      `/crm/v2/tenant/${this.tenant.tenantId}/employees`,
    ];

    for (const source of payrollSources) {
      if (techIdMap.size > 0) break;
      try {
        console.log(`[ServiceTitan] Fetching tech IDs from: ${source}`);
        let page = 1;
        let hasMore = true;
        while (hasMore && page <= 20) {
          const resp = await this.request<{ data: any[]; hasMore: boolean }>(
            `${source}?pageSize=200&page=${page}`
          );
          for (const rec of resp.data ?? []) {
            const id: number | undefined =
              rec.technicianId ?? rec.technician?.id;
            const name: string =
              rec.technicianName ??
              rec.technician?.name ??
              `Technician ${id}`;
            if (id != null) techIdMap.set(id, name);
          }
          hasMore = resp.hasMore ?? false;
          page++;
        }
        console.log(`[ServiceTitan] Found ${techIdMap.size} unique tech IDs from ${source}`);
      } catch (err: any) {
        console.log(`[ServiceTitan] ${source} failed: ${err?.message}`);
      }
    }

    if (techIdMap.size === 0) {
      throw new Error(
        "Could not retrieve a technician list from ServiceTitan. " +
        "The Payroll module (for rate lookup) is enabled, but listing technicians requires " +
        "one additional module. In your API app at developer.servicetitan.io, " +
        "also enable the 'Settings', 'HRM', or 'Dispatch' module, then save."
      );
    }

    // Step 2: fetch payroll-settings for each technician (scope: Payroll Settings)
    const results: Array<{ rate: number; name: string }> = [];
    const BATCH = 5;
    const techEntries = [...techIdMap.entries()];

    for (let i = 0; i < techEntries.length; i += BATCH) {
      const batch = techEntries.slice(i, i + BATCH);
      const settled = await Promise.allSettled(
        batch.map(async ([techId, techName]) => {
          const settings = await this.request<any>(
            `/payroll/v2/tenant/${this.tenant.tenantId}/technicians/${techId}/payroll-settings`
          );
          return {
            rate: Number(settings.hourlyRate ?? 0),
            name: techName,
          };
        })
      );
      for (const r of settled) {
        if (r.status === "fulfilled") {
          results.push(r.value);
        } else {
          console.warn("[ServiceTitan] payroll-settings fetch failed:", r.reason?.message ?? r.reason);
        }
      }
    }

    if (results.length === 0) {
      throw new Error(
        `Found ${techIdMap.size} technician ID(s) but could not retrieve payroll-settings for any. ` +
        "Check that the Payroll Settings scope is enabled."
      );
    }

    const highest = results.reduce(
      (best, cur) => (cur.rate > best.rate ? cur : best),
      { rate: 0, name: "Unknown" }
    );

    if (highest.rate <= 0) {
      throw new Error(
        `Found ${techIdMap.size} technician(s) but all hourlyRate values are $0. ` +
        "Ensure technician pay rates are entered in ServiceTitan Payroll settings."
      );
    }

    return {
      rate: highest.rate,
      technicianName: highest.name,
      technicianCount: techIdMap.size,
    };
  }

  async uploadServiceImage(serviceId: number, imageBuffer: Buffer, filename: string, mimeType: string): Promise<any> {
    const token = await this.getAccessToken();
    
    const formData = new FormData();
    const blob = new Blob([imageBuffer], { type: mimeType });
    formData.append('file', blob, filename);
    
    // First upload image to the pricebook images endpoint
    const uploadResponse = await fetch(
      `${this.baseUrl}/pricebook/v2/tenant/${this.tenant.tenantId}/images`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          "ST-App-Key": this.tenant.appKey,
        },
        body: formData,
      }
    );

    if (!uploadResponse.ok) {
      const error = await uploadResponse.text();
      console.log(`[UploadImage] Upload failed: ${uploadResponse.status} - ${error}`);
      throw new Error(`Failed to upload image: ${uploadResponse.status} - ${error}`);
    }

    const uploadResult = await uploadResponse.json();
    console.log(`[UploadImage] Image uploaded, result:`, JSON.stringify(uploadResult));
    
    // Then update the service with the image as an asset
    if (uploadResult && uploadResult.path) {
      const updateResponse = await this.request<PricebookService>(
        `/pricebook/v2/tenant/${this.tenant.tenantId}/services/${serviceId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ 
            assets: [{ type: "Image", url: uploadResult.path }]
          }),
        }
      );
      console.log(`[UploadImage] Service updated with asset image path: ${uploadResult.path}`);
      return updateResponse;
    }
    
    return uploadResult;
  }

}

interface GLAccount {
  id: number;
  name: string;
  number?: string;
  type?: string;
  detailType?: string;
  active: boolean;
}

interface CreateServiceRequest {
  code: string;
  displayName: string;
  description?: string;
  warranty?: { duration: number; description: string };
  taxable?: boolean;
  active?: boolean;
  price?: number;
  memberPrice?: number;
  hours?: number;
  categories?: number[];
  account?: string; // Account name like "Sales", not a numeric ID
  allowDiscountCodes?: boolean;
  allowMembershipDiscounts?: boolean;
}

export type { PricebookCategory, PricebookService, PricebookMaterial, PricebookEquipment, GLAccount, CreateServiceRequest };
