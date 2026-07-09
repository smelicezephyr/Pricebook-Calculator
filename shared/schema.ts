import { pgTable, text, serial, numeric, timestamp, boolean, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Locations (reference library for sales tax rates)
export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  salesTaxPercent: numeric("sales_tax_percent").notNull().default("0.00"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ServiceTitan Tenants
export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  tenantId: text("tenant_id").notNull(),
  clientId: text("client_id").notNull(),
  clientSecret: text("client_secret").notNull(),
  appKey: text("app_key").notNull(),
  locationId: integer("location_id"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Users (Google OAuth)
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  googleId: text("google_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  role: text("role", { enum: ["everyone", "user", "manager", "admin"] }).notNull().default("everyone"),
  pushPermission: text("push_permission", { enum: ["both", "reprice_only", "add_new_only"] }).notNull().default("both"),
  emailNotifications: boolean("email_notifications").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Which tenants a "user"-role account can access
export const userTenantAccess = pgTable("user_tenant_access", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
}, (table) => ({
  uniqueUserTenant: uniqueIndex("unique_user_tenant").on(table.userId, table.tenantId),
}));

// Settings for the calculator (defaults based on the sheet)
export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  targetMePercent: numeric("target_me_percent").notNull().default("23.00"),
  salesTaxPercent: numeric("sales_tax_percent").notNull().default("6.35"),
  defaultTenantId: integer("default_tenant_id"),
  
  // Labor Settings
  laborMode: text("labor_mode", { enum: ["hours", "percent"] }).notNull().default("percent"),
  laborHourlyRate: numeric("labor_hourly_rate").notNull().default("0.00"),
  laborPercent: numeric("labor_percent").notNull().default("7.00"),
  laborBurdenPercent: numeric("labor_burden_percent").notNull().default("20.00"),
  
  // Commission Settings
  commissionPercent: numeric("commission_percent").notNull().default("10.00"),
  commissionBurdenPercent: numeric("commission_burden_percent").notNull().default("20.00"),
  
  // Financing Settings
  financingFeePercent: numeric("financing_fee_percent").notNull().default("6.00"),
  
  // Margin Health Settings
  grossMarginMinPercent: numeric("gross_margin_min_percent").notNull().default("52.00"),
  
  // ServiceTitan Section Password (kept for legacy, no longer used for auth)
  serviceTitanPassword: text("servicetitan_password").notNull().default("ZephyrHome160"),
  
  // Admin Section PIN (kept for legacy, no longer used for auth)
  adminPin: text("admin_pin").notNull().default("7437"),
});

// Push History for ServiceTitan
export const pushHistory = pgTable("push_history", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  status: text("status", { enum: ["pending", "in_progress", "completed", "failed", "cancelled", "reverted"] }).notNull().default("pending"),
  
  // Settings snapshot used for this push
  categoryIds: text("category_ids").notNull(),
  targetMePercent: numeric("target_me_percent").notNull(),
  salesTaxPercent: numeric("sales_tax_percent").notNull(),
  laborMode: text("labor_mode").notNull(),
  laborHourlyRate: numeric("labor_hourly_rate").notNull(),
  laborHours: numeric("labor_hours").notNull().default("8"),
  laborPercent: numeric("labor_percent").notNull(),
  laborBurdenPercent: numeric("labor_burden_percent").notNull(),
  commissionPercent: numeric("commission_percent").notNull(),
  commissionBurdenPercent: numeric("commission_burden_percent").notNull(),
  financingFeePercent: numeric("financing_fee_percent").notNull(),
  roundUp: boolean("round_up").notNull().default(false),
  skipZeroEquipment: boolean("skip_zero_equipment").notNull().default(false),
  
  // Results
  processedCount: integer("processed_count").default(0),
  updatedCount: integer("updated_count").default(0),
  skippedCount: integer("skipped_count").default(0),
  errorCount: integer("error_count").default(0),
  errorMessages: text("error_messages"),
  
  // Original values for revert functionality (JSON: [{serviceId, originalPrice, originalCost}])
  originalValues: text("original_values"),

  // Push type — update (bulk reprice), new_system (new install task), new_repair (new repair task)
  pushType: text("push_type").default("update"),

  // Attribution — who initiated this push
  pushedByUserId: integer("pushed_by_user_id"),
  pushedByName: text("pushed_by_name"),

  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

// Saved Quotes/Calculations
export const quotes = pgTable("quotes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  title: text("title").notNull().default("Untitled Quote"),
  customerName: text("customer_name"),
  materialsCost: numeric("materials_cost").notNull(),
  equipmentCost: numeric("equipment_cost").notNull(),
  laborHoursInput: numeric("labor_hours_input").default("10"),
  
  // Snapshotted results (to keep history even if settings change)
  calculatedPrice: numeric("calculated_price").notNull(),
  calculatedGrossMargin: numeric("calculated_gross_margin").notNull(),
  calculatedEstimatedLabor: numeric("calculated_estimated_labor").notNull(),
  calculatedMePercent: numeric("calculated_me_percent").notNull(),
  
  // Other COGS
  subcontractorCost: numeric("subcontractor_cost").notNull().default("0.00"),
  craneCost: numeric("crane_cost").notNull().default("0.00"),
  permitCost: numeric("permit_cost").notNull().default("0.00"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLocationSchema = createInsertSchema(locations).omit({
  id: true,
  createdAt: true,
});

export const insertSettingsSchema = createInsertSchema(settings);
export const insertQuoteSchema = createInsertSchema(quotes).omit({ 
  id: true,
  userId: true,
  createdAt: true 
});
export const insertTenantSchema = createInsertSchema(tenants).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Update schema makes credentials optional (keep existing if not provided)
export const updateTenantSchema = createInsertSchema(tenants).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  clientId: true,
  clientSecret: true,
  appKey: true,
});

export const insertPushHistorySchema = createInsertSchema(pushHistory).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
  processedCount: true,
  updatedCount: true,
  skippedCount: true,
  errorCount: true,
  errorMessages: true,
  originalValues: true,
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export type Location = typeof locations.$inferSelect;
export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type Settings = typeof settings.$inferSelect;
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Quote = typeof quotes.$inferSelect;
export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type PushHistory = typeof pushHistory.$inferSelect;
export type InsertPushHistory = z.infer<typeof insertPushHistorySchema>;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UserTenantAccess = typeof userTenantAccess.$inferSelect;

// Login event log
export const loginEvents = pgTable("login_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  userEmail: text("user_email").notNull(),
  userName: text("user_name").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
export type LoginEvent = typeof loginEvents.$inferSelect;
