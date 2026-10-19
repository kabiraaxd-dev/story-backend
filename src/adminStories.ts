import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db";
import { authenticate, requireRole } from "./auth";
import { readingMinutes } from "./readingTime";

const storyBody = z.object({
  title: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  summary: z.string().min(1),
  content: z.string().min(1),
  mainImageUrl: z.string().url().nullable().optional(),
  audioUrl: z.string().url().nullable().optional(),
  authorId: z.number().int(),
  categoryId: z.number().int(),
  ageGroupId: z.number().int(),
  tagIds: z.array(z.number().int()).default([]),
});
const unpublishBody = z.object({
  status: z.enum(["DRAFT", "IN_REVIEW"]),
});

type Actor = { sub: number; role: "ADMIN" | "CREATOR" };
const canEdit = (u: Actor, s: { createdById: number | null; status: string }) =>
  u.role === "ADMIN" || (s.createdById === u.sub && s.status !== "PUBLISHED");

export async function adminStoryRoutes(app: FastifyInstance) {
  const guard = { preHandler: [authenticate, requireRole("ADMIN", "CREATOR")] };
  const adminOnly = { preHandler: [authenticate, requireRole("ADMIN")] };

  app.get("/admin/stories", guard, async (req) => {
    const where: Prisma.StoryWhereInput =
      req.user.role === "ADMIN" ? {} : { createdById: req.user.sub };
    return prisma.story.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        author: { select: { name: true } },
        createdById: true,
        updatedAt: true,
      },
    });
  });

  app.post("/admin/stories", guard, async (req, reply) => {
    const parsed = storyBody.safeParse(req.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: "Invalid input", details: parsed.error.flatten() });
    const { tagIds, ...data } = parsed.data;
    try {
      const story = await prisma.story.create({
        data: {
          ...data,
          readingMinutes: readingMinutes(data.content),
          status: "DRAFT",
          createdById: req.user.sub,
          tags: { connect: tagIds.map((id) => ({ id })) },
        },
      });
      return reply.code(201).send(story);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      )
        return reply.code(409).send({ error: "Slug already exists" });
      throw e;
    }
  });

   app.get<{ Params: { id: string } }>(
     "/admin/stories/:id",
     guard,
     async (req, reply) => {
       const story = await prisma.story.findUnique({
         where: { id: Number(req.params.id) },
         include: { tags: { select: { id: true } } },
       });
       if (!story) return reply.code(404).send({ error: "Not found" });
       if (req.user.role !== "ADMIN" && story.createdById !== req.user.sub)
         return reply.code(403).send({ error: "Forbidden" });
       return story;
     },
   );

  app.patch<{ Params: { id: string } }>(
    "/admin/stories/:id",
    guard,
    async (req, reply) => {
      const id = Number(req.params.id);
      const existing = await prisma.story.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: "Not found" });
      if (!canEdit(req.user, existing))
        return reply.code(403).send({ error: "Forbidden" });

      const parsed = storyBody.partial().safeParse(req.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "Invalid input" });
      const { tagIds, ...data } = parsed.data;
      return prisma.story.update({
        where: { id },
        data: {
          ...data,
          ...(data.content !== undefined && {
            readingMinutes: readingMinutes(data.content),
          }),
          ...(tagIds && { tags: { set: tagIds.map((t) => ({ id: t })) } }),
        },
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/stories/:id/submit",
    guard,
    async (req, reply) => {
      const id = Number(req.params.id);
      const existing = await prisma.story.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: "Not found" });
      if (!canEdit(req.user, existing))
        return reply.code(403).send({ error: "Forbidden" });
      return prisma.story.update({
        where: { id },
        data: { status: "IN_REVIEW" },
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/stories/:id/publish",
    adminOnly,
    async (req, reply) => {
      const id = Number(req.params.id);
      try {
        return await prisma.story.update({
          where: { id },
          data: { status: "PUBLISHED", publishedAt: new Date() },
        });
      } catch {
        return reply.code(404).send({ error: "Not found" });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/stories/:id/unpublish",
    adminOnly,
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1)
        return reply.code(400).send({ error: "Invalid id" });

      const parsed = unpublishBody.safeParse(req.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "Status must be DRAFT or IN_REVIEW" });

      const story = await prisma.story.findUnique({ where: { id } });
      if (!story) return reply.code(404).send({ error: "Not found" });
      if (story.status !== "PUBLISHED")
        return reply.code(409).send({ error: "Only published stories can be unpublished" });

      return prisma.story.update({
        where: { id },
        data: { status: parsed.data.status },
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/admin/stories/:id",
    adminOnly,
    async (req, reply) => {
      try {
        await prisma.story.delete({ where: { id: Number(req.params.id) } });
        return reply.code(204).send();
      } catch {
        return reply.code(404).send({ error: "Not found" });
      }
    },
  );
}
