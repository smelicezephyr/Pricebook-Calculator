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
  parentId?: number;
}

interface PricebookService {
  id: number;
  name: string;
  code: string;
  description?: string;
  price?: number;
  memberPrice?: number;
  addOnPrice?: number;
  active: boolean;
  categoryId?: number;
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
    
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
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
  }

  async testConnection(): Promise<void> {
    // This will throw with a detailed error if authentication fails
    await this.getAccessToken();
  }

  async getCategories(): Promise<PricebookCategory[]> {
    const response = await this.request<{ data: PricebookCategory[] }>(
      `/pricebook/v2/tenant/${this.tenant.tenantId}/categories?pageSize=500`
    );
    return response.data;
  }

  async getServices(categoryId?: number): Promise<PricebookService[]> {
    let url = `/pricebook/v2/tenant/${this.tenant.tenantId}/services?pageSize=500`;
    if (categoryId) {
      url += `&categoryId=${categoryId}`;
    }
    const response = await this.request<{ data: PricebookService[] }>(url);
    return response.data;
  }

  async getMaterials(categoryId?: number): Promise<PricebookMaterial[]> {
    let url = `/pricebook/v2/tenant/${this.tenant.tenantId}/materials?pageSize=500`;
    if (categoryId) {
      url += `&categoryId=${categoryId}`;
    }
    const response = await this.request<{ data: PricebookMaterial[] }>(url);
    return response.data;
  }

  async getEquipment(categoryId?: number): Promise<PricebookEquipment[]> {
    let url = `/pricebook/v2/tenant/${this.tenant.tenantId}/equipment?pageSize=500`;
    if (categoryId) {
      url += `&categoryId=${categoryId}`;
    }
    const response = await this.request<{ data: PricebookEquipment[] }>(url);
    return response.data;
  }

  async updateService(
    serviceId: number,
    updates: { price?: number; memberPrice?: number }
  ): Promise<PricebookService> {
    return this.request<PricebookService>(
      `/pricebook/v2/tenant/${this.tenant.tenantId}/services/${serviceId}`,
      {
        method: "PATCH",
        body: JSON.stringify(updates),
      }
    );
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
