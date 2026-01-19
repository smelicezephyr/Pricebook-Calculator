import { pgTable, text, serial, numeric, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Settings for the calculator (defaults based on the sheet)
export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  targetMePercent: numeric("target_me_percent").notNull().default("23.00"),
  salesTaxPercent: numeric("sales_tax_percent").notNull().default("6.35"),
  
  // Labor Settings
  laborMode: text("labor_mode", { enum: ["hours", "percent"] }).notNull().default("hours"),
  laborHourlyRate: numeric("labor_hourly_rate").notNull().default("125.00"), // Derived from $1250/10hrs
  laborPercent: numeric("labor_percent").notNull().default("10.00"), // Fallback if percent mode
  laborBurdenPercent: numeric("labor_burden_percent").notNull().default("20.00"),
  
  // Commission Settings
  commissionPercent: numeric("commission_percent").notNull().default("8.00"),
  commissionBurdenPercent: numeric("commission_burden_percent").notNull().default("20.00"),
  
  // Financing Settings
  financingFeePercent: numeric("financing_fee_percent").notNull().default("8.00"),
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
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSettingsSchema = createInsertSchema(settings);
export const insertQuoteSchema = createInsertSchema(quotes).omit({ 
  id: true, 
  createdAt: true 
});

export type Settings = typeof settings.$inferSelect;
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Quote = typeof quotes.$inferSelect;
export type InsertQuote = z.infer<typeof insertQuoteSchema>;
