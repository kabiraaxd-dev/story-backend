import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import argon2 from "argon2";
import { z } from "zod";
import { prisma } from "./db";
import { authenticate, requirePermission } from "./auth";

const roleEnum = z.enum(["ADMIN", "CREATOR", "REVIEWER", "TAXONOMY_MANAGER"]);
const rolesField = z
  .array(roleEnum)
  .min(1, "Pick at least one role")
  .transform((r) => [...new Set(r)]);

const createBody = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10, "Password must be at least 10 characters"),
  roles: rolesField,
});

const patchBody = z.object({
  name: z.string().trim().min(1).optional(),
  roles: rolesField.optional(),
  active: z.boolean().optional(),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .optional(),
});

const publicSelect = {
  id: true,
  name: true,
  email: true,
  roles: true,
  active: true,
  createdAt: true,
  _count: { select: { createdStories: true } },
} satisfies Prisma.UserSelect;

export async function userRoutes(app: FastifyInstance) {
  const guard = {
    preHandler: [authenticate, requirePermission("user:manage")],
  };

  app.get("/admin/users", guard, () =>
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: publicSelect,
    }),
  );

  app.post("/admin/users", guard, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    const { password, ...data } = parsed.data;
    try {
      const user = await prisma.user.create({
        data: { ...data, passwordHash: await argon2.hash(password) },
        select: publicSelect,
      });
      return reply.code(201).send(user);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      )
        return reply
          .code(409)
          .send({ error: "A user with that email already exists" });
      throw e;
    }
  });

  app.patch<{ Params: { id: string } }>(
    "/admin/users/:id",
    guard,
    async (req, reply) => {
      const id = Number(req.params.id);
      const parsed = patchBody.safeParse(req.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
      const { password, roles, ...rest } = parsed.data;

      // Safeguard: you can't change your own roles or deactivate yourself.
      // Only admins reach this route, so this also guarantees the last admin can never be removed.
      if (
        id === req.user.sub &&
        (roles !== undefined || rest.active !== undefined)
      ) {
        return reply
          .code(400)
          .send({ error: "You can't change your own roles or active status" });
      }

      try {
        return await prisma.user.update({
          where: { id },
          data: {
            ...rest,
            ...(roles && { roles: { set: roles } }),
            ...(password && { passwordHash: await argon2.hash(password) }),
          },
          select: publicSelect,
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2025"
        )
          return reply.code(404).send({ error: "Not found" });
        throw e;
      }
    },
  );
}
