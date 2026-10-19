import type { Role } from "@prisma/client";

export const ALL_PERMISSIONS = [
  "story:write",
  "story:review",
  "story:publish",
  "story:delete",
  "taxonomy:manage",
  "user:manage",
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

const GRANTS: Record<Role, readonly (Permission | "*")[]> = {
  ADMIN: ["*"],
  CREATOR: ["story:write"],
  REVIEWER: ["story:review", "story:publish"],
  TAXONOMY_MANAGER: ["taxonomy:manage"],
};

export const can = (roles: readonly Role[], permission: Permission) =>
  roles.some((r) => GRANTS[r].includes("*") || GRANTS[r].includes(permission));

export const permissionsFor = (roles: readonly Role[]) =>
  ALL_PERMISSIONS.filter((p) => can(roles, p));

export const isAdmin = (roles: readonly Role[]) => roles.includes("ADMIN");
