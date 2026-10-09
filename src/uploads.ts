import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import sharp from "sharp";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { authenticate, requireRole } from "./auth";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const PUBLIC_URL = (
  process.env.API_PUBLIC_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

const MAX = { image: 5 * 1024 * 1024, audio: 20 * 1024 * 1024 };
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const AUDIO_TYPES = ["audio/mpeg", "audio/mp4", "audio/x-m4a"];

// Check the first bytes of the file: MP3 starts with "ID3" or a frame sync; M4A has "ftyp" at byte 4.
function looksLikeAudio(buf: Buffer) {
  const isMp3 =
    buf.subarray(0, 3).toString("latin1") === "ID3" ||
    (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
  const isM4a = buf.subarray(4, 8).toString("latin1") === "ftyp";
  return isMp3 || isM4a;
}

export async function uploadRoutes(app: FastifyInstance) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  await app.register(multipart, { limits: { fileSize: MAX.audio, files: 1 } });
  await app.register(fastifyStatic, { root: UPLOAD_DIR, prefix: "/media/" });

  const guard = { preHandler: [authenticate, requireRole("ADMIN", "CREATOR")] };

  app.post<{ Params: { kind: string } }>(
    "/admin/uploads/:kind",
    guard,
    async (req, reply) => {
      const kind = req.params.kind;
      if (kind !== "image" && kind !== "audio")
        return reply.code(404).send({ error: "Not found" });

      const part = await req.file();
      if (!part) return reply.code(400).send({ error: "No file received" });

      let buf: Buffer;
      try {
        buf = await part.toBuffer();
      } catch {
        return reply.code(413).send({ error: "File too large" });
      }
      if (buf.length > MAX[kind]) {
        return reply
          .code(413)
          .send({
            error: `File too large (max ${MAX[kind] / 1024 / 1024} MB)`,
          });
      }

      // Audio: save as is.
      if (kind === "audio") {
        if (!AUDIO_TYPES.includes(part.mimetype) || !looksLikeAudio(buf)) {
          return reply
            .code(400)
            .send({ error: "Only MP3 or M4A audio is allowed" });
        }
        const ext = part.mimetype === "audio/mpeg" ? "mp3" : "m4a";
        const rel = `audio/${randomUUID()}.${ext}`;
        await mkdir(path.join(UPLOAD_DIR, "audio"), { recursive: true });
        await writeFile(path.join(UPLOAD_DIR, rel), buf);
        return { url: `${PUBLIC_URL}/media/${rel}` };
      }

      // Image: decode, resize to three WebP sizes, save.
      if (!IMAGE_TYPES.includes(part.mimetype)) {
        return reply
          .code(400)
          .send({ error: "Only JPEG, PNG or WebP images are allowed" });
      }
      try {
        const widths = [400, 800, 1600];
        const outputs: Buffer[] = [];
        for (const width of widths) {
          outputs.push(
            await sharp(buf, { limitInputPixels: 50_000_000 })
              .rotate()
              .resize({ width, withoutEnlargement: true })
              .webp({ quality: 80 })
              .toBuffer(),
          );
        }
        const id = randomUUID();
        const dir = path.join(UPLOAD_DIR, "images", id);
        await mkdir(dir, { recursive: true });
        const variants: Record<number, string> = {};
        for (let i = 0; i < widths.length; i++) {
          await writeFile(path.join(dir, `${widths[i]}.webp`), outputs[i]);
          variants[widths[i]] =
            `${PUBLIC_URL}/media/images/${id}/${widths[i]}.webp`;
        }
        return { url: variants[800], variants };
      } catch {
        return reply
          .code(400)
          .send({ error: "That file is not a valid image" });
      }
    },
  );
}
