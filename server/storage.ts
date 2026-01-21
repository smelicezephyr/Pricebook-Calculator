import { db } from "./db";
import {
  settings,
  quotes,
  tenants,
  type Settings,
  type InsertSettings,
  type Quote,
  type InsertQuote,
  type Tenant,
  type InsertTenant
} from "@shared/schema";
import { eq, desc, asc } from "drizzle-orm";

export interface IStorage {
  getSettings(): Promise<Settings>;
  updateSettings(settings: InsertSettings): Promise<Settings>;
  
  createQuote(quote: InsertQuote): Promise<Quote>;
  getQuotes(): Promise<Quote[]>;
  deleteQuote(id: number): Promise<void>;
  
  getTenants(): Promise<Tenant[]>;
  getTenant(id: number): Promise<Tenant | undefined>;
  createTenant(tenant: InsertTenant): Promise<Tenant>;
  updateTenant(id: number, tenant: Partial<InsertTenant>): Promise<Tenant>;
  deleteTenant(id: number): Promise<void>;
  reorderTenants(orderedIds: number[]): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getSettings(): Promise<Settings> {
    const [existing] = await db.select().from(settings).limit(1);
    if (existing) return existing;
    
    // Create default settings if none exist
    const [created] = await db.insert(settings).values({}).returning();
    return created;
  }

  async updateSettings(newSettings: InsertSettings): Promise<Settings> {
    // Always update the single row with ID 1, or create it
    const existing = await this.getSettings();
    const [updated] = await db
      .update(settings)
      .set(newSettings)
      .where(eq(settings.id, existing.id))
      .returning();
    return updated;
  }

  async createQuote(quote: InsertQuote): Promise<Quote> {
    const [created] = await db.insert(quotes).values(quote).returning();
    return created;
  }

  async getQuotes(): Promise<Quote[]> {
    return await db.select().from(quotes).orderBy(desc(quotes.createdAt));
  }

  async deleteQuote(id: number): Promise<void> {
    await db.delete(quotes).where(eq(quotes.id, id));
  }

  async getTenants(): Promise<Tenant[]> {
    return await db.select().from(tenants).orderBy(asc(tenants.sortOrder), asc(tenants.id));
  }

  async getTenant(id: number): Promise<Tenant | undefined> {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
    return tenant;
  }

  async createTenant(tenant: InsertTenant): Promise<Tenant> {
    const [created] = await db.insert(tenants).values(tenant).returning();
    return created;
  }

  async updateTenant(id: number, tenant: Partial<InsertTenant>): Promise<Tenant> {
    const [updated] = await db
      .update(tenants)
      .set({ ...tenant, updatedAt: new Date() })
      .where(eq(tenants.id, id))
      .returning();
    return updated;
  }

  async deleteTenant(id: number): Promise<void> {
    await db.delete(tenants).where(eq(tenants.id, id));
  }

  async reorderTenants(orderedIds: number[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      await db
        .update(tenants)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(eq(tenants.id, orderedIds[i]));
    }
  }
}

export const storage = new DatabaseStorage();
