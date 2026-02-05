import { pgTable, text, serial, numeric, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ServiceTitan Tenants
export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  tenantId: text("tenant_id").notNull(),
  clientId: text("client_id").notNull(),
  clientSecret: text("client_secret").notNull(),
  appKey: text("app_key").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Settings for the calculator (defaults based on the sheet)
export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  targetMePercent: numeric("target_me_percent").notNull().default("23.00"),
  salesTaxPercent: numeric("sales_tax_percent").notNull().default("6.35"),
  
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
  
  // ServiceTitan Section Password
  serviceTitanPassword: text("servicetitan_password").notNull().default("ZephyrHome160"),
});

// Push History for ServiceTitan
export const pushHistory = pgTable("push_history", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  status: text("status", { enum: ["pending", "in_progress", "completed", "failed", "cancelled", "reverted"] }).notNull().default("pending"),
  
  // Settings snapshot used for this push
  categoryIds: text("category_ids").notNull(), // JSON array of category IDs
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
  
  // Results
  processedCount: integer("processed_count").default(0),
  updatedCount: integer("updated_count").default(0),
  skippedCount: integer("skipped_count").default(0),
  errorCount: integer("error_count").default(0),
  errorMessages: text("error_messages"), // JSON array of error messages
  
  // Original values for revert functionality (JSON: [{serviceId, originalPrice, originalCost}])
  originalValues: text("original_values"),
  
  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

// Saved Quotes/Calculations
export const quotes = pgTable("quotes", {
  id: serial("id").primaryKey(),
  title: text("title").notNull().default("Untitled Quote"),
  materialsCost: numeric("materials_cost").notNull(),
  equipmentCost: numeric("equipment_cost").notNull(),
  laborHoursInput: numeric("labor_hours_input").default("10"), // For hours mode
  
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

export const insertSettingsSchema = createInsertSchema(settings);
export const insertQuoteSchema = createInsertSchema(quotes).omit({ 
  id: true, 
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

export type Settings = typeof settings.$inferSelect;
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Quote = typeof quotes.$inferSelect;
export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type PushHistory = typeof pushHistory.$inferSelect;
export type InsertPushHistory = z.infer<typeof insertPushHistorySchema>;
