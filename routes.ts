
import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth } from "./auth";
import { type Permission, type PermissionsMap, ALL_PERMISSIONS } from "@shared/schema";

function coerceDates(body: any): any {
  const dateFields = ['gpsTimestamp', 'createdAt', 'updatedAt'];
  const result = { ...body };
  for (const field of dateFields) {
    if (typeof result[field] === 'string') {
      result[field] = new Date(result[field]);
    }
  }
  return result;
}

function isAdmin(req: Request): boolean {
  return req.isAuthenticated() && req.user?.role === 'admin';
}

function isAdminOrSecondary(req: Request): boolean {
  return req.isAuthenticated() && (req.user?.role === 'admin' || req.user?.role === 'secondary_admin');
}

function hasPermission(req: Request, permission: Permission): boolean {
  if (!req.isAuthenticated()) return false;
  if (req.user?.role === 'admin') return true;
  if (req.user?.role === 'secondary_admin') {
    const perms = req.user.permissions as PermissionsMap | null;
    return perms?.[permission] === true;
  }
  return false;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupAuth(app);

  // === RECORDS ROUTES ===
  app.get(api.records.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).send();
    if (req.user!.role === 'secondary_admin' && !hasPermission(req, 'viewRecords')) {
      return res.status(403).json({ message: "No permission to view records" });
    }
    
    const filters = {
      agentId: req.query.agentId ? Number(req.query.agentId) : undefined,
      search: req.query.search as string,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      town: req.query.town as string,
      area: req.query.area as string,
    };

    const records = await storage.getRecords(filters);
    res.json(records);
  });

  app.post(api.records.create.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).send();
    
    if (req.user!.role !== 'agent' && !hasPermission(req, 'addRecords')) {
      return res.status(403).json({ message: "No permission to add records" });
    }

    try {
      const input = api.records.create.input.omit({ collectedBy: true }).parse(coerceDates(req.body));
      let collectedBy = req.user!.id;
      if (isAdminOrSecondary(req) && req.body.collectedBy) {
        collectedBy = Number(req.body.collectedBy);
      }
      const record = await storage.createRecord({
        ...input,
        collectedBy,
      });
      res.status(201).json(record);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.put(api.records.update.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).send();
    if (!hasPermission(req, 'editRecords') && req.user?.role !== 'agent') {
      return res.status(403).json({ message: "No permission to edit records" });
    }
    const id = Number(req.params.id);
    
    try {
      const input = api.records.update.input.parse(coerceDates(req.body));
      const record = await storage.updateRecord(id, input);
      if (!record) return res.status(404).json({ message: "Record not found" });
      res.json(record);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.delete(api.records.delete.path, async (req, res) => {
    if (!hasPermission(req, 'deleteRecords')) return res.status(403).send();
    await storage.deleteRecord(Number(req.params.id));
    res.status(204).send();
  });

  // === CUSTOM COLUMNS ROUTES ===
  app.get(api.customColumns.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).send();
    const columns = await storage.getCustomColumns();
    res.json(columns);
  });

  app.post(api.customColumns.create.path, async (req, res) => {
    if (!hasPermission(req, 'manageCustomColumns')) return res.status(403).send();
    try {
      const input = api.customColumns.create.input.parse(req.body);
      const column = await storage.createCustomColumn(input);
      res.status(201).json(column);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      }
      throw err;
    }
  });

  app.put(api.customColumns.update.path, async (req, res) => {
    if (!hasPermission(req, 'manageCustomColumns')) return res.status(403).send();
    try {
      const input = api.customColumns.update.input.parse(req.body);
      const column = await storage.updateCustomColumn(Number(req.params.id), input);
      res.json(column);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      }
      throw err;
    }
  });

  app.delete(api.customColumns.delete.path, async (req, res) => {
    if (!hasPermission(req, 'manageCustomColumns')) return res.status(403).send();
    await storage.deleteCustomColumn(Number(req.params.id));
    res.status(204).send();
  });

  // === AGENT MANAGEMENT ROUTES ===
  app.get(api.agents.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).send();
    if (req.user!.role === 'secondary_admin' && !hasPermission(req, 'viewAgents')) {
      return res.status(403).json({ message: "No permission to view agents" });
    }
    const agents = await storage.getAgents();
    res.json(agents);
  });

  app.post(api.agents.create.path, async (req, res) => {
    if (!hasPermission(req, 'createAgents')) return res.status(403).send();
    
    try {
      const input = api.agents.create.input.parse(req.body);
      const existing = await storage.getUserByUsername(input.username);
      if (existing) {
        return res.status(400).json({ message: "Username already exists" });
      }
      const agent = await storage.createUser(input);
      res.status(201).json(agent);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.put(api.agents.update.path, async (req, res) => {
    if (!hasPermission(req, 'editAgents')) return res.status(403).send();
    const id = Number(req.params.id);

    try {
      const input = api.agents.update.input.parse(req.body);
      const agent = await storage.updateUser(id, input);
      res.json(agent);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  // === SECONDARY ADMIN ROUTES (System Admin only) ===
  app.get(api.secondaryAdmins.list.path, async (req, res) => {
    if (!isAdmin(req)) return res.status(403).send();
    const admins = await storage.getSecondaryAdmins();
    res.json(admins);
  });

  app.post(api.secondaryAdmins.create.path, async (req, res) => {
    if (!isAdmin(req)) return res.status(403).send();
    
    try {
      const input = api.secondaryAdmins.create.input.parse(req.body);
      const existing = await storage.getUserByUsername(input.username);
      if (existing) {
        return res.status(400).json({ message: "Username already exists" });
      }
      const admin = await storage.createUser({
        ...input,
        role: "secondary_admin",
      });
      res.status(201).json(admin);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.put(api.secondaryAdmins.update.path, async (req, res) => {
    if (!isAdmin(req)) return res.status(403).send();
    const id = Number(req.params.id);

    try {
      const input = api.secondaryAdmins.update.input.parse(req.body);
      const admin = await storage.updateUser(id, input);
      res.json(admin);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  // === STATS ENDPOINT (Admin + Secondary with viewStats) ===
  app.get(api.stats.summary.path, async (req, res) => {
    if (!hasPermission(req, 'viewStats')) return res.status(403).send();
    const period = (req.query.period as string) || 'day';
    const validPeriods = ['day', 'week', 'month'] as const;
    const safePeriod = validPeriods.includes(period as any) ? period as 'day' | 'week' | 'month' : 'day';
    const stats = await storage.getStats(safePeriod);
    res.json(stats);
  });

  // Seed data on startup
  await seedDatabase();

  return httpServer;
}

async function seedDatabase() {
  const admin = await storage.getUserByUsername("admin");
  if (!admin) {
    console.log("Seeding admin user...");
    await storage.createUser({
      username: "admin",
      password: "admin123",
      fullName: "System Administrator",
      role: "admin",
      isActive: true,
    });
    
    await storage.createUser({
      username: "agent1",
      password: "password",
      fullName: "John Doe",
      role: "agent",
      isActive: true,
    });
  }
}
