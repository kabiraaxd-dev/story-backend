import Fastify from "fastify";
import cors from "@fastify/cors";
import { PrismaClient, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { registerAuth } from "./auth";
import { authRoutes } from "./authRoutes";
import { adminStoryRoutes } from "./adminStories";

// const prisma = new PrismaClient();
const app = Fastify({ logger: true });

const storySummary = {
  id: true,
  title: true,
  slug: true,
  summary: true,
  mainImageUrl: true,
  audioUrl: true,
  category: { select: { name: true, slug: true } },
  ageGroup: { select: { id: true, label: true } },
  author: { select: { name: true } },
  tags: { select: { name: true, slug: true } },
} satisfies Prisma.StorySelect;

async function start() {
  // await app.register(cors, { origin: "http://localhost:5173" });
  await app.register(cors, {
    origin: ["http://localhost:5173", "http://localhost:5174"],
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
   
   await registerAuth(app);
   await app.register(authRoutes);
   await app.register(adminStoryRoutes);

  app.get("/health", async () => ({ ok: true }));

  app.get<{
    Querystring: {
      category?: string;
      tag?: string;
      ageGroup?: string;
      q?: string;
      page?: string;
      pageSize?: string;
    };
  }>("/stories", async (req) => {
    const { category, tag, ageGroup, q } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(
      50,
      Math.max(1, Number(req.query.pageSize) || 12),
    );

    const where: Prisma.StoryWhereInput = { status: "PUBLISHED" };
    if (category) where.category = { slug: category };
    if (tag) where.tags = { some: { slug: tag } };
    if (ageGroup && Number(ageGroup)) where.ageGroupId = Number(ageGroup);
    if (q) where.title = { contains: q, mode: "insensitive" };

    const [items, total] = await Promise.all([
      prisma.story.findMany({
        where,
        select: storySummary,
        orderBy: { publishedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.story.count({ where }),
    ]);
    return { items, total, page, pageSize };
  });

  app.get<{ Params: { slug: string } }>(
    "/stories/:slug",
    async (req, reply) => {
      const story = await prisma.story.findFirst({
        where: { slug: req.params.slug, status: "PUBLISHED" },
        select: { ...storySummary, content: true },
      });
      if (!story) return reply.code(404).send({ error: "Story not found" });
      return story;
    },
  );

  app.get("/categories", () =>
    prisma.category.findMany({ orderBy: { name: "asc" } }),
  );
  app.get("/authors", () =>
    prisma.author.findMany({ orderBy: { name: "asc" } }),
  );
  app.get("/tags", () => prisma.tag.findMany({ orderBy: { name: "asc" } }));
  app.get("/age-groups", () =>
    prisma.ageGroup.findMany({ orderBy: { minAge: "asc" } }),
  );

  await app.listen({ port: 3000 });
}

start();
