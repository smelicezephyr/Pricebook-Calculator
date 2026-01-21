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
  grossMarginMinPercent: numeric("gross_margin_min_percent").notNull().default("50.00"),
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

export type Settings = typeof settings.$inferSelect;
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Quote = typeof quotes.$inferSelect;
export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;
