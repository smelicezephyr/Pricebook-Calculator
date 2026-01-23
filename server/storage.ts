import { db } from "./db";
import {
  settings,
  quotes,
  tenants,
  pushHistory,
  type Settings,
  type InsertSettings,
  type Quote,
  type InsertQuote,
  type Tenant,
  type InsertTenant,
  type PushHistory,
  type InsertPushHistory
} from "@shared/schema";
import { eq, desc, asc, and } from "drizzle-orm";

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
  
  // Push History
  getPushHistory(tenantId?: number): Promise<PushHistory[]>;
  getPushHistoryItem(id: number): Promise<PushHistory | undefined>;
  createPushHistory(item: InsertPushHistory): Promise<PushHistory>;
  updatePushHistory(id: number, updates: Partial<PushHistory>): Promise<PushHistory>;
  deletePushHistory(id: number): Promise<void>;
  getPendingPushes(tenantId: number): Promise<PushHistory[]>;
  getInProgressPushes(): Promise<PushHistory[]>;
  cleanupStalePushes(): Promise<number>;
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

  async getPushHistory(tenantId?: number): Promise<PushHistory[]> {
    if (tenantId !== undefined) {
      return await db.select().from(pushHistory)
        .where(eq(pushHistory.tenantId, tenantId))
        .orderBy(desc(pushHistory.createdAt));
    }
    return await db.select().from(pushHistory).orderBy(desc(pushHistory.createdAt));
  }

  async getPushHistoryItem(id: number): Promise<PushHistory | undefined> {
    const [item] = await db.select().from(pushHistory).where(eq(pushHistory.id, id));
    return item;
  }

  async createPushHistory(item: InsertPushHistory): Promise<PushHistory> {
    const [created] = await db.insert(pushHistory).values(item).returning();
    return created;
  }

  async updatePushHistory(id: number, updates: Partial<PushHistory>): Promise<PushHistory> {
    const [updated] = await db
      .update(pushHistory)
      .set(updates)
      .where(eq(pushHistory.id, id))
      .returning();
    return updated;
  }

  async deletePushHistory(id: number): Promise<void> {
    await db.delete(pushHistory).where(eq(pushHistory.id, id));
  }

  async getPendingPushes(tenantId: number): Promise<PushHistory[]> {
    return await db.select().from(pushHistory)
      .where(and(
        eq(pushHistory.tenantId, tenantId),
        eq(pushHistory.status, "pending")
      ))
      .orderBy(asc(pushHistory.createdAt));
  }

  async getInProgressPushes(): Promise<PushHistory[]> {
    return await db.select().from(pushHistory)
      .where(eq(pushHistory.status, "in_progress"))
      .orderBy(asc(pushHistory.createdAt));
  }

  async cleanupStalePushes(): Promise<number> {
    const stalePushes = await db.select().from(pushHistory)
      .where(eq(pushHistory.status, "in_progress"));
    
    let cleanedUp = 0;
    for (const push of stalePushes) {
      await db.update(pushHistory)
        .set({
          status: "failed",
          completedAt: new Date(),
          errorMessages: JSON.stringify(["Push interrupted by server restart"]),
          errorCount: 1,
        })
        .where(eq(pushHistory.id, push.id));
      cleanedUp++;
    }
    
    // Also mark pending (queued) pushes as cancelled since queue state is lost
    const pendingPushes = await db.select().from(pushHistory)
      .where(eq(pushHistory.status, "pending"));
    
    for (const push of pendingPushes) {
      await db.update(pushHistory)
        .set({
          status: "cancelled",
          completedAt: new Date(),
          errorMessages: JSON.stringify(["Queued push cancelled by server restart"]),
        })
        .where(eq(pushHistory.id, push.id));
      cleanedUp++;
    }
    
    return cleanedUp;
  }
}

export const storage = new DatabaseStorage();
