import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import jwt from "@fastify/jwt";
import cookie from "@fastify/cookie";
import type { Role } from "@prisma/client";
import { can, type Permission } from "./permissions";

type TokenPayload = { sub: number; roles: Role[]; type: "access" | "refresh" };

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
    // Tokens issued before this change carry a single `role`, not `roles`. Reject them so the client refreshes.
    if (!Array.isArray(req.user.roles)) throw new Error("old token format");
  } catch {
    return reply.code(401).send({ error: "Unauthorized" });
  }
}

// Allows the request if the user has ANY of the listed permissions.
export const requirePermission =
  (...permissions: Permission[]) =>
  async (req: FastifyRequest, reply: FastifyReply) => {
    if (!permissions.some((p) => can(req.user.roles, p))) {
      return reply.code(403).send({ error: "Forbidden" });
    }
  };
