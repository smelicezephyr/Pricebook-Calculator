import { db, pool } from "./db";
import {
  settings,
  quotes,
  tenants,
  locations,
  pushHistory,
  users,
  userTenantAccess,
  loginEvents,
  type Settings,
  type InsertSettings,
  type Quote,
  type InsertQuote,
  type Tenant,
  type InsertTenant,
  type Location,
  type InsertLocation,
  type PushHistory,
  type InsertPushHistory,
  type User,
  type InsertUser,
} from "@shared/schema";
import { eq, desc, asc, and, inArray } from "drizzle-orm";

export interface IStorage {
  getSettings(): Promise<Settings>;
  updateSettings(settings: InsertSettings): Promise<Settings>;
  
  createQuote(quote: InsertQuote, userId: number): Promise<Quote>;
  getQuotes(userId: number, isAdmin: boolean): Promise<Quote[]>;
  deleteQuote(id: number, userId: number, isAdmin: boolean): Promise<{ ok: boolean; forbidden?: boolean }>;
  clearUserQuotes(userId: number): Promise<void>;
  clearAllQuotes(): Promise<void>;
  
  getLocations(): Promise<Location[]>;
  getLocation(id: number): Promise<Location | undefined>;
  createLocation(location: InsertLocation): Promise<Location>;
  updateLocation(id: number, location: Partial<InsertLocation>): Promise<Location>;
  deleteLocation(id: number): Promise<void>;
  
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

  // Users
  getUserByGoogleId(googleId: string): Promise<User | undefined>;
  getUserById(id: number): Promise<User | undefined>;
  upsertUser(userData: { googleId: string; email: string; name: string; avatarUrl?: string }): Promise<User>;
  listUsers(): Promise<User[]>;
  countUsers(): Promise<number>;
  updateUserRole(id: number, role: "everyone" | "user" | "admin"): Promise<User>;
  updateUserPushPermission(id: number, pushPermission: "both" | "reprice_only" | "add_new_only"): Promise<User>;
  deleteUser(id: number): Promise<void>;
  getUserTenantIds(userId: number): Promise<number[]>;
  setUserTenantAccess(userId: number, tenantIds: number[]): Promise<void>;

  // Login Events
  logLoginEvent(userId: number, email: string, name: string): Promise<void>;
  listLoginEvents(limit?: number): Promise<{ id: number; userId: number | null; userEmail: string; userName: string; createdAt: Date | null }[]>;

  // Admin Email Notifications
  getAdminEmailSubscribers(): Promise<User[]>;
  setEmailNotifications(userId: number, enabled: boolean): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getSettings(): Promise<Settings> {
    const [existing] = await db.select().from(settings).limit(1);
    if (existing) return existing;
    
    const [created] = await db.insert(settings).values({}).returning();
    return created;
  }

  async updateSettings(newSettings: InsertSettings): Promise<Settings> {
    const existing = await this.getSettings();
    const [updated] = await db
      .update(settings)
      .set(newSettings)
      .where(eq(settings.id, existing.id))
      .returning();
    return updated;
  }

  async createQuote(quote: InsertQuote, userId: number): Promise<Quote> {
    const [created] = await db.insert(quotes).values({ ...quote, userId }).returning();
    return created;
  }

  async getQuotes(userId: number, isAdmin: boolean): Promise<Quote[]> {
    if (isAdmin) {
      return await db.select().from(quotes).orderBy(desc(quotes.createdAt));
    }
    return await db.select().from(quotes)
      .where(eq(quotes.userId, userId))
      .orderBy(desc(quotes.createdAt));
  }

  async deleteQuote(id: number, userId: number, isAdmin: boolean): Promise<{ ok: boolean; forbidden?: boolean }> {
    const [item] = await db.select().from(quotes).where(eq(quotes.id, id));
    if (!item) return { ok: false };
    if (!isAdmin && item.userId !== userId) return { ok: false, forbidden: true };
    await db.delete(quotes).where(eq(quotes.id, id));
    return { ok: true };
  }

  async clearUserQuotes(userId: number): Promise<void> {
    await db.delete(quotes).where(eq(quotes.userId, userId));
  }

  async clearAllQuotes(): Promise<void> {
    await db.delete(quotes);
  }

  async getLocations(): Promise<Location[]> {
    return await db.select().from(locations).orderBy(asc(locations.name));
  }

  async getLocation(id: number): Promise<Location | undefined> {
    const [location] = await db.select().from(locations).where(eq(locations.id, id));
    return location;
  }

  async createLocation(location: InsertLocation): Promise<Location> {
    const [created] = await db.insert(locations).values(location).returning();
    return created;
  }

  async updateLocation(id: number, location: Partial<InsertLocation>): Promise<Location> {
    const [updated] = await db
      .update(locations)
      .set(location)
      .where(eq(locations.id, id))
      .returning();
    return updated;
  }

  async deleteLocation(id: number): Promise<void> {
    await db.update(tenants).set({ locationId: null }).where(eq(tenants.locationId, id));
    await db.delete(locations).where(eq(locations.id, id));
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

  // ── Users ──────────────────────────────────────────────────────────────────

  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.googleId, googleId));
    return user;
  }

  async getUserById(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: { googleId: string; email: string; name: string; avatarUrl?: string }): Promise<User> {
    const existing = await this.getUserByGoogleId(userData.googleId);
    if (existing) {
      const [updated] = await db.update(users)
        .set({ email: userData.email, name: userData.name, avatarUrl: userData.avatarUrl ?? null })
        .where(eq(users.googleId, userData.googleId))
        .returning();
      return updated;
    }

    // Check if this is the very first user — auto-promote to admin
    const count = await this.countUsers();
    const role = count === 0 ? "admin" : "everyone";

    const [created] = await db.insert(users)
      .values({ ...userData, role })
      .returning();
    return created;
  }

  async listUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(asc(users.createdAt));
  }

  async countUsers(): Promise<number> {
    const result = await db.select().from(users);
    return result.length;
  }

  async updateUserRole(id: number, role: "everyone" | "user" | "admin"): Promise<User> {
    const [updated] = await db.update(users)
      .set({ role })
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  async updateUserPushPermission(id: number, pushPermission: "both" | "reprice_only" | "add_new_only"): Promise<User> {
    const [updated] = await db.update(users)
      .set({ pushPermission })
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  async deleteUser(id: number): Promise<void> {
    // Deleting the user cascades to user_tenant_access.
    // Also wipe their sessions so they can't keep using an active cookie.
    await db.delete(users).where(eq(users.id, id));
    await pool.query(`DELETE FROM session WHERE sess->>'passport' IS NOT NULL AND (sess->'passport'->>'user')::int = $1`, [id]);
  }

  async getUserTenantIds(userId: number): Promise<number[]> {
    const rows = await db.select().from(userTenantAccess)
      .where(eq(userTenantAccess.userId, userId));
    return rows.map(r => r.tenantId);
  }

  async setUserTenantAccess(userId: number, tenantIds: number[]): Promise<void> {
    await db.delete(userTenantAccess).where(eq(userTenantAccess.userId, userId));
    if (tenantIds.length > 0) {
      await db.insert(userTenantAccess)
        .values(tenantIds.map(tid => ({ userId, tenantId: tid })));
    }
  }

  async logLoginEvent(userId: number, email: string, name: string): Promise<void> {
    await db.insert(loginEvents).values({ userId, userEmail: email, userName: name });
  }

  async listLoginEvents(limit = 200) {
    return await db.select().from(loginEvents)
      .orderBy(desc(loginEvents.createdAt))
      .limit(limit);
  }

  async getAdminEmailSubscribers(): Promise<User[]> {
    return await db.select().from(users)
      .where(and(eq(users.role, "admin"), eq(users.emailNotifications, true)));
  }

  async setEmailNotifications(userId: number, enabled: boolean): Promise<void> {
    await db.update(users).set({ emailNotifications: enabled }).where(eq(users.id, userId));
  }
}


export const storage = new DatabaseStorage();
