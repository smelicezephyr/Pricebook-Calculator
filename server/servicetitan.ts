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
  level?: number;
  categoryType?: string;
  displayOrder?: number;
  [key: string]: any; // Allow additional fields from API
}

interface PricebookService {
  id: number;
  name: string;
  code: string;
  description?: string;
  price?: number;
  memberPrice?: number;
  addOnPrice?: number;
  cost?: number; // Estimated Labor Cost field in ServiceTitan
  hours?: number; // Hours field in ServiceTitan
  active: boolean;
  categoryId?: number;
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

interface PricebookMaterial {
  id: number;
  name: string;
  code: string;
  cost: number;
  price: number;
  active: boolean;
  categoryId?: number;
}

interface PricebookEquipment {
  id: number;
  name: string;
  code: string;
  cost: number;
  price: number;
  active: boolean;
  categoryId?: number;
}

const tokenCache: Map<number, { token: string; expiresAt: number }> = new Map();

export class ServiceTitanAPI {
  private tenant: Tenant;
  private baseUrl = "https://api.servicetitan.io";
  private authUrl = "https://auth.servicetitan.io/connect/token";

  constructor(tenant: Tenant) {
    this.tenant = tenant;
  }

  private async getAccessToken(): Promise<string> {
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
        const error = await response.text();
        throw new Error(`ServiceTitan API error: ${response.status} - ${error}`);
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
      for (const category of response.data) {
        allCategories.push(category);
        // Recursively add all nested subcategories
        this.flattenSubcategories(category, allCategories);
      }
      
      hasMore = response.hasMore;
      page++;
      
      // Safety limit to prevent infinite loops
      if (page > 50) break;
    }
    
    console.log(`[ServiceTitan] Total categories (including subcategories): ${allCategories.length}`);
    return allCategories;
  }
  
  private flattenSubcategories(category: PricebookCategory, result: PricebookCategory[]): void {
    if (category.subcategories && Array.isArray(category.subcategories)) {
      for (const sub of category.subcategories) {
        result.push(sub);
        // Recursively handle deeper nesting if present
        this.flattenSubcategories(sub, result);
      }
    }
  }

  async getServices(categoryId?: number): Promise<PricebookService[]> {
    // Request embedded materials and equipment data
    let url = `/pricebook/v2/tenant/${this.tenant.tenantId}/services?pageSize=500&expand=materials,equipment`;
    if (categoryId) {
      url += `&categoryId=${categoryId}`;
    }
    const response = await this.request<{ data: PricebookService[] }>(url);
    return response.data;
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
      const url = `/pricebook/v2/tenant/${this.tenant.tenantId}/equipment?pageSize=500&page=${page}`;
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
}

export type { PricebookCategory, PricebookService, PricebookMaterial, PricebookEquipment };
