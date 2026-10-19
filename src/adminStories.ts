import type { FastifyInstance } from "fastify";
import { Prisma, type Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db";
import { authenticate, requirePermission } from "./auth";
import { can, isAdmin } from "./permissions";

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

const noteBody = z.object({
  note: z.string().trim().min(3, "Please explain what to change").max(1000),
});

type Actor = { sub: number; roles: Role[] };
type StoryLike = { createdById: number | null; status: string };

const isOwn = (u: Actor, s: StoryLike) => s.createdById === u.sub;

// Who may edit content: Admin always; a Writer only their own story while it is a draft or needs changes.
const canEdit = (u: Actor, s: StoryLike) =>
  isAdmin(u.roles) ||
  (can(u.roles, "story:write") &&
    isOwn(u, s) &&
    (s.status === "DRAFT" || s.status === "CHANGES_REQUESTED"));

// Who may see a story in the admin: reviewers see all, writers see their own.
const canView = (u: Actor, s: StoryLike) =>
  can(u.roles, "story:review") || isOwn(u, s);

export async function adminStoryRoutes(app: FastifyInstance) {
  const authed = [authenticate];
  const writer = { preHandler: [...authed, requirePermission("story:write")] };
  const viewer = {
    preHandler: [...authed, requirePermission("story:write", "story:review")],
  };
  const reviewer = {
    preHandler: [...authed, requirePermission("story:review")],
  };
  const publisher = {
    preHandler: [...authed, requirePermission("story:publish")],
  };
  const deleter = {
    preHandler: [...authed, requirePermission("story:delete")],
  };

  app.get("/admin/stories", viewer, async (req) => {
    const where: Prisma.StoryWhereInput = can(req.user.roles, "story:review")
      ? {}
      : { createdById: req.user.sub };
    return prisma.story.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        createdById: true,
        updatedAt: true,
        reviewNote: true,
        createdBy: { select: { name: true } },
      },
    });
  });

  app.get<{ Params: { id: string } }>(
    "/admin/stories/:id",
    viewer,
    async (req, reply) => {
      const story = await prisma.story.findUnique({
        where: { id: Number(req.params.id) },
        include: { tags: { select: { id: true } } },
      });
      if (!story) return reply.code(404).send({ error: "Not found" });
      if (!canView(req.user, story))
        return reply.code(403).send({ error: "Forbidden" });
      return story;
    },
  );

  app.post("/admin/stories", writer, async (req, reply) => {
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

  app.patch<{ Params: { id: string } }>(
    "/admin/stories/:id",
    writer,
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
      try {
        return await prisma.story.update({
          where: { id },
          data: {
            ...data,
            ...(tagIds && { tags: { set: tagIds.map((t) => ({ id: t })) } }),
          },
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002"
        )
          return reply.code(409).send({ error: "Slug already exists" });
        throw e;
      }
    },
  );

  // DRAFT or CHANGES_REQUESTED -> IN_REVIEW
  app.post<{ Params: { id: string } }>(
    "/admin/stories/:id/submit",
    writer,
    async (req, reply) => {
      const id = Number(req.params.id);
      const existing = await prisma.story.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: "Not found" });
      if (!canEdit(req.user, existing))
        return reply.code(403).send({ error: "Forbidden" });
      if (
        existing.status !== "DRAFT" &&
        existing.status !== "CHANGES_REQUESTED"
      )
        return reply.code(409).send({ error: "Only drafts can be submitted" });
      return prisma.story.update({
        where: { id },
        data: { status: "IN_REVIEW" },
      });
    },
  );

  // IN_REVIEW -> CHANGES_REQUESTED (note required)
  app.post<{ Params: { id: string } }>(
    "/admin/stories/:id/request-changes",
    reviewer,
    async (req, reply) => {
      const parsed = noteBody.safeParse(req.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });

      const id = Number(req.params.id);
      const existing = await prisma.story.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: "Not found" });
      if (isOwn(req.user, existing) && !isAdmin(req.user.roles))
        return reply
          .code(403)
          .send({ error: "You cannot review your own story" });
      if (existing.status !== "IN_REVIEW")
        return reply.code(409).send({ error: "Story is not in review" });

      return prisma.story.update({
        where: { id },
        data: {
          status: "CHANGES_REQUESTED",
          reviewNote: parsed.data.note,
          reviewedById: req.user.sub,
          reviewedAt: new Date(),
        },
      });
    },
  );

  // IN_REVIEW -> PUBLISHED
  app.post<{ Params: { id: string } }>(
    "/admin/stories/:id/publish",
    publisher,
    async (req, reply) => {
      const id = Number(req.params.id);
      const existing = await prisma.story.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: "Not found" });
      if (isOwn(req.user, existing) && !isAdmin(req.user.roles))
        return reply
          .code(403)
          .send({ error: "You cannot approve your own story" });
      if (existing.status !== "IN_REVIEW")
        return reply.code(409).send({ error: "Story must be in review first" });

      const now = new Date();
      return prisma.story.update({
        where: { id },
        data: {
          status: "PUBLISHED",
          publishedAt: now,
          publishedById: req.user.sub,
          reviewedById: req.user.sub,
          reviewedAt: now,
          reviewNote: null,
        },
      });
    },
  );

  // PUBLISHED -> DRAFT
  app.post<{ Params: { id: string } }>(
    "/admin/stories/:id/unpublish",
    publisher,
    async (req, reply) => {
      const id = Number(req.params.id);
      const existing = await prisma.story.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: "Not found" });
      if (existing.status !== "PUBLISHED")
        return reply.code(409).send({ error: "Story is not published" });
      return prisma.story.update({
        where: { id },
        data: { status: "DRAFT", publishedAt: null },
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/admin/stories/:id",
    deleter,
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
