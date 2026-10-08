import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
const prisma = new PrismaClient();

async function main() {
  await prisma.story.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.category.deleteMany();
  await prisma.ageGroup.deleteMany();
  await prisma.author.deleteMany();
  await prisma.user.deleteMany();

  const author = await prisma.author.create({ data: { name: "Asha Rao" } });
  const [animals, magic] = await Promise.all([
    prisma.category.create({ data: { name: "Animals", slug: "animals" } }),
    prisma.category.create({ data: { name: "Magic", slug: "magic" } }),
  ]);
  const [young, older] = await Promise.all([
    prisma.ageGroup.create({ data: { label: "3-5", minAge: 3, maxAge: 5 } }),
    prisma.ageGroup.create({ data: { label: "6-8", minAge: 6, maxAge: 8 } }),
  ]);
  const [bedtime, funny] = await Promise.all([
    prisma.tag.create({ data: { name: "Bedtime", slug: "bedtime" } }),
    prisma.tag.create({ data: { name: "Funny", slug: "funny" } }),
  ]);

  const stories = [
    {
      title: "The Brave Little Fox",
      slug: "brave-little-fox",
      cat: animals.id,
      age: young.id,
      tags: [bedtime.id],
    },
    {
      title: "The Sleepy Owl",
      slug: "sleepy-owl",
      cat: animals.id,
      age: young.id,
      tags: [bedtime.id, funny.id],
    },
    {
      title: "The Wand That Hiccuped",
      slug: "wand-that-hiccuped",
      cat: magic.id,
      age: older.id,
      tags: [funny.id],
    },
  ];

  for (const s of stories) {
    await prisma.story.create({
      data: {
        title: s.title,
        slug: s.slug,
        summary: `A short tale: ${s.title}.`,
        content: `Once upon a time...\n\nThis is the full text of "${s.title}".\n\nThe end.`,
        mainImageUrl: `https://picsum.photos/seed/${s.slug}/600/400`,
        status: "PUBLISHED",
        publishedAt: new Date(),
        authorId: author.id,
        categoryId: s.cat,
        ageGroupId: s.age,
        tags: { connect: s.tags.map((id) => ({ id })) },
      },
    });
  }
  await prisma.user.create({
    data: {
      email: "admin@example.com",
      name: "Admin",
      role: "ADMIN",
      passwordHash: await argon2.hash("Admin#12345"),
    },
  });
  await prisma.user.create({
    data: {
      email: "creator@example.com",
      name: "Creator",
      role: "CREATOR",
      passwordHash: await argon2.hash("Creator#12345"),
    },
  });
}

main().finally(() => prisma.$disconnect());
