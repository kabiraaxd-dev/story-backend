import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db";
import { authenticate, requirePermission } from "./auth";

const authorSchema = z.object({
  name: z.string().trim().min(1),
  bio: z.string().trim().nullable().optional(),
});
const categorySchema = z.object({
  name: z.string().trim().min(1),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
});
const ageGroupFields = z.object({
  label: z.string().trim().min(1),
  minAge: z.number().int().min(0),
  maxAge: z.number().int().min(0),
});
const ageGroupSchema = ageGroupFields.refine((value) => value.maxAge >= value.minAge, {
  message: "Maximum age must be greater than or equal to minimum age",
  path: ["maxAge"],
});
const tagSchema = categorySchema;

type EntityWithId = { id: number };

function registerEntityRoutes<T extends EntityWithId, Create, Update>(
  app: FastifyInstance,
  path: string,
  createSchema: z.ZodType<Create>,
  updateSchema: z.ZodType<Update>,
  repository: {
    list: () => Promise<T[]>;
    find: (id: number) => Promise<T | null>;
    create: (data: Create) => Promise<T>;
    update: (id: number, data: Update) => Promise<T>;
  },
  validateUpdate?: (existing: T, data: Update) => string | null,
) {
  const adminOnly = { preHandler: [authenticate, requirePermission("ADMIN")] };

  app.get(path, adminOnly, () => repository.list());
  app.get<{ Params: { id: string } }>(`${path}/:id`, adminOnly, async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: "Invalid id" });
    const entity = await repository.find(id);
    if (!entity) return reply.code(404).send({ error: "Not found" });
    return entity;
  });
  app.post(path, adminOnly, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    try {
      return reply.code(201).send(await repository.create(parsed.data));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.code(409).send({ error: "A record with these values already exists" });
      }
      throw error;
    }
  });
  app.patch<{ Params: { id: string } }>(`${path}/:id`, adminOnly, async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: "Invalid id" });
    const existing = await repository.find(id);
    if (!existing) return reply.code(404).send({ error: "Not found" });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    const validationError = validateUpdate?.(existing, parsed.data);
    if (validationError) return reply.code(400).send({ error: validationError });
    try {
      return await repository.update(id, parsed.data);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.code(409).send({ error: "A record with these values already exists" });
      }
      throw error;
    }
  });
}

export async function adminEntityRoutes(app: FastifyInstance) {
  registerEntityRoutes(
    app,
    "/admin/authors",
    authorSchema,
    authorSchema.partial(),
    {
      list: () => prisma.author.findMany({ orderBy: { name: "asc" } }),
      find: (id) => prisma.author.findUnique({ where: { id } }),
      create: (data) => prisma.author.create({ data }),
      update: (id, data) => prisma.author.update({ where: { id }, data }),
    },
  );
  registerEntityRoutes(
    app,
    "/admin/categories",
    categorySchema,
    categorySchema.partial(),
    {
      list: () => prisma.category.findMany({ orderBy: { name: "asc" } }),
      find: (id) => prisma.category.findUnique({ where: { id } }),
      create: (data) => prisma.category.create({ data }),
      update: (id, data) => prisma.category.update({ where: { id }, data }),
    },
  );
  registerEntityRoutes(
    app,
    "/admin/age-groups",
    ageGroupSchema,
    ageGroupFields.partial(),
    {
      list: () => prisma.ageGroup.findMany({ orderBy: { minAge: "asc" } }),
      find: (id) => prisma.ageGroup.findUnique({ where: { id } }),
      create: (data) => prisma.ageGroup.create({ data }),
      update: (id, data) => prisma.ageGroup.update({ where: { id }, data }),
    },
    (existing, data) => {
      const minAge = data.minAge ?? existing.minAge;
      const maxAge = data.maxAge ?? existing.maxAge;
      return maxAge >= minAge
        ? null
        : "Maximum age must be greater than or equal to minimum age";
    },
  );
  registerEntityRoutes(
    app,
    "/admin/tags",
    tagSchema,
    tagSchema.partial(),
    {
      list: () => prisma.tag.findMany({ orderBy: { name: "asc" } }),
      find: (id) => prisma.tag.findUnique({ where: { id } }),
      create: (data) => prisma.tag.create({ data }),
      update: (id, data) => prisma.tag.update({ where: { id }, data }),
    },
  );
}
