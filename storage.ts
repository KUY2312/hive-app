
import { db } from "./db";
import {
  users, records, customColumns,
  type User, type InsertUser,
  type RecordItem, type InsertRecord,
  type UpdateRecordRequest, type UpdateUserRequest,
  type CustomColumn, type InsertCustomColumn
} from "@shared/schema";
import { eq, desc, and, ilike, gte, lte, sql, count, or, ne } from "drizzle-orm";

import session from "express-session";
import createMemoryStore from "memorystore";

const MemoryStore = createMemoryStore(session);

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, updates: UpdateUserRequest): Promise<User>;
  getAgents(): Promise<User[]>;
  getSecondaryAdmins(): Promise<User[]>;
  sessionStore: session.Store;

  getCustomColumns(): Promise<CustomColumn[]>;
  createCustomColumn(column: InsertCustomColumn): Promise<CustomColumn>;
  updateCustomColumn(id: number, updates: Partial<InsertCustomColumn>): Promise<CustomColumn>;
  deleteCustomColumn(id: number): Promise<void>;

  getRecords(filters?: { 
    agentId?: number; 
    search?: string; 
    startDate?: Date; 
    endDate?: Date;
    town?: string;
    area?: string;
  }): Promise<RecordItem[]>;
  getRecord(id: number): Promise<RecordItem | undefined>;
  createRecord(record: InsertRecord): Promise<RecordItem>;
  updateRecord(id: number, updates: UpdateRecordRequest): Promise<RecordItem>;
  deleteRecord(id: number): Promise<void>;
  getStats(period?: 'day' | 'week' | 'month'): Promise<{
    totalRecords: number;
    recordsPerAgent: { agentId: number; agentName: string; count: number }[];
    recordsByPeriod: { date: string; count: number }[];
  }>;
}

export class DatabaseStorage implements IStorage {
  sessionStore: session.Store;

  constructor() {
    this.sessionStore = new MemoryStore({
      checkPeriod: 86400000,
    });
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const auth = await import("./auth");
    const plainPwd = insertUser.password;
    const hashedPassword = await auth.hashPassword(insertUser.password);
    const [user] = await db.insert(users).values({
      ...insertUser,
      password: hashedPassword,
      plainPassword: plainPwd,
    }).returning();
    return user;
  }

  async updateUser(id: number, updates: UpdateUserRequest): Promise<User> {
    if (updates.password) {
      const auth = await import("./auth");
      (updates as any).plainPassword = updates.password;
      updates.password = await auth.hashPassword(updates.password);
    }
    const [user] = await db.update(users).set(updates).where(eq(users.id, id)).returning();
    return user;
  }

  async getAgents(): Promise<User[]> {
    return await db.select().from(users).where(eq(users.role, "agent"));
  }

  async getSecondaryAdmins(): Promise<User[]> {
    return await db.select().from(users).where(eq(users.role, "secondary_admin"));
  }

  async getCustomColumns(): Promise<CustomColumn[]> {
    return await db.select().from(customColumns).orderBy(customColumns.createdAt);
  }

  async createCustomColumn(column: InsertCustomColumn): Promise<CustomColumn> {
    const [created] = await db.insert(customColumns).values(column).returning();
    return created;
  }

  async updateCustomColumn(id: number, updates: Partial<InsertCustomColumn>): Promise<CustomColumn> {
    const [updated] = await db.update(customColumns).set(updates).where(eq(customColumns.id, id)).returning();
    return updated;
  }

  async deleteCustomColumn(id: number): Promise<void> {
    await db.delete(customColumns).where(eq(customColumns.id, id));
  }

  async getRecords(filters?: { 
    agentId?: number; 
    search?: string; 
    startDate?: Date; 
    endDate?: Date;
    town?: string;
    area?: string;
  }): Promise<RecordItem[]> {
    const conditions = [];

    if (filters?.agentId) {
      conditions.push(eq(records.collectedBy, filters.agentId));
    }
    if (filters?.search) {
      conditions.push(ilike(records.landlordName, `%${filters.search}%`));
    }
    if (filters?.startDate) {
      conditions.push(gte(records.createdAt, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(records.createdAt, filters.endDate));
    }
    if (filters?.town) {
      conditions.push(ilike(records.town, `%${filters.town}%`));
    }
    if (filters?.area) {
      conditions.push(ilike(records.area, `%${filters.area}%`));
    }

    return await db.select()
      .from(records)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(records.createdAt));
  }

  async getRecord(id: number): Promise<RecordItem | undefined> {
    const [record] = await db.select().from(records).where(eq(records.id, id));
    return record;
  }

  async createRecord(insertRecord: InsertRecord): Promise<RecordItem> {
    const [record] = await db.insert(records).values(insertRecord).returning();
    return record;
  }

  async updateRecord(id: number, updates: UpdateRecordRequest): Promise<RecordItem> {
    const [record] = await db.update(records).set({ ...updates, updatedAt: new Date() }).where(eq(records.id, id)).returning();
    return record;
  }

  async deleteRecord(id: number): Promise<void> {
    await db.delete(records).where(eq(records.id, id));
  }

  async getStats(period: 'day' | 'week' | 'month' = 'day'): Promise<{
    totalRecords: number;
    recordsPerAgent: { agentId: number; agentName: string; count: number }[];
    recordsByPeriod: { date: string; count: number }[];
  }> {
    const allRecords = await db.select().from(records);
    const totalRecords = allRecords.length;

    const agentList = await db.select().from(users).where(eq(users.role, "agent"));
    const agentMap = new Map(agentList.map(a => [a.id, a.fullName]));

    const agentCounts: Record<number, number> = {};
    const dateCounts: Record<string, number> = {};

    for (const r of allRecords) {
      agentCounts[r.collectedBy] = (agentCounts[r.collectedBy] || 0) + 1;
      
      if (r.createdAt) {
        const d = new Date(r.createdAt);
        let dateKey: string;
        if (period === 'week') {
          const startOfWeek = new Date(d);
          startOfWeek.setDate(d.getDate() - d.getDay());
          dateKey = `W ${startOfWeek.toISOString().split('T')[0]}`;
        } else if (period === 'month') {
          dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        } else {
          dateKey = d.toISOString().split('T')[0];
        }
        dateCounts[dateKey] = (dateCounts[dateKey] || 0) + 1;
      }
    }

    const recordsPerAgent = Object.entries(agentCounts).map(([id, cnt]) => ({
      agentId: Number(id),
      agentName: agentMap.get(Number(id)) || `Agent #${id}`,
      count: cnt,
    }));

    const recordsByPeriod = Object.entries(dateCounts)
      .map(([date, cnt]) => ({ date, count: cnt }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return { totalRecords, recordsPerAgent, recordsByPeriod };
  }
}

export const storage = new DatabaseStorage();
