import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import jwt from "@fastify/jwt";
import cookie from "@fastify/cookie";
import { Role } from "@prisma/client";

type TokenPayload = { sub: number; role: Role; type: "access" | "refresh" };

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: TokenPayload;
    user: TokenPayload;
  }
}

export async function registerAuth(app: FastifyInstance) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("JWT_SECRET missing or too short");
  await app.register(cookie);
  await app.register(jwt, { secret });
}

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
    if (req.user.type !== "access") throw new Error("wrong token type");
  } catch {
    return reply.code(401).send({ error: "Unauthorized" });
  }
}

export const requireRole =
  (...roles: Role[]) =>
  async (req: FastifyRequest, reply: FastifyReply) => {
    if (!roles.includes(req.user.role))
      return reply.code(403).send({ error: "Forbidden" });
  };
