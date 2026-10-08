import type { FastifyInstance, FastifyReply } from "fastify";
import argon2 from "argon2";
import { z } from "zod";
import { prisma } from "./db";
import { authenticate } from "./auth";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function setRefreshCookie(reply: FastifyReply, token: string) {
  reply.setCookie("refresh_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/auth",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function authRoutes(app: FastifyInstance) {
  const accessFor = (u: { id: number; role: "ADMIN" | "CREATOR" }) =>
    app.jwt.sign(
      { sub: u.id, role: u.role, type: "access" },
      { expiresIn: "15m" },
    );

  app.post("/auth/login", async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid input" });

    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email },
    });
    const ok = user
      ? await argon2.verify(user.passwordHash, parsed.data.password)
      : false;
    if (!user || !ok)
      return reply.code(401).send({ error: "Invalid email or password" });

    const refresh = app.jwt.sign(
      { sub: user.id, role: user.role, type: "refresh" },
      { expiresIn: "7d" },
    );
    setRefreshCookie(reply, refresh);
    return {
      accessToken: accessFor(user),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  });

  app.post("/auth/refresh", async (req, reply) => {
    const token = req.cookies.refresh_token;
    if (!token) return reply.code(401).send({ error: "No refresh token" });
    try {
      const payload = app.jwt.verify<{ sub: number; type: string }>(token);
      if (payload.type !== "refresh") throw new Error("wrong type");
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) throw new Error("no user");
      return {
        accessToken: accessFor(user),
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      };
    } catch {
      return reply.code(401).send({ error: "Invalid refresh token" });
    }
  });

  app.post("/auth/logout", async (_req, reply) => {
    reply.clearCookie("refresh_token", { path: "/auth" });
    return { ok: true };
  });

  app.get("/auth/me", { preHandler: authenticate }, async (req) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: { id: true, name: true, email: true, role: true },
    });
    return user;
  });
}
