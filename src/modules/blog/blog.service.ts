import { prisma } from "../../lib/prisma";
import { NotFoundError } from "../../utils/httpError";

export interface BlogListParams {
  skip: number;
  take: number;
}

export async function listBlogPosts({ skip, take }: BlogListParams) {
  const [items, total] = await Promise.all([
    prisma.blogPost.findMany({ orderBy: { publishedDate: "desc" }, skip, take }),
    prisma.blogPost.count(),
  ]);
  return { items, total };
}

export async function getBlogPostBySlug(slug: string) {
  const post = await prisma.blogPost.findUnique({ where: { slug } });
  if (!post) {
    throw NotFoundError("Blog post not found");
  }
  return post;
}

export async function getBlogPostById(id: bigint) {
  const post = await prisma.blogPost.findUnique({ where: { id } });
  if (!post) {
    throw NotFoundError("Blog post not found");
  }
  return post;
}

// Used both for auto-generating a unique slug (generateUniqueSlug's probe
// function) and for validating an explicitly-supplied slug on create/update.
export async function slugExists(slug: string, excludeId?: bigint): Promise<boolean> {
  const existing = await prisma.blogPost.findUnique({ where: { slug } });
  if (!existing) {
    return false;
  }
  if (excludeId !== undefined && existing.id === excludeId) {
    return false;
  }
  return true;
}

export interface BlogInput {
  title: string;
  slug: string;
  content: string;
  tags?: string | null;
  userProfileId: bigint;
}

export async function createBlogPost(input: BlogInput) {
  return prisma.blogPost.create({
    data: {
      title: input.title,
      slug: input.slug,
      content: input.content,
      tags: input.tags,
      userProfileId: input.userProfileId,
    },
  });
}

export async function updateBlogPost(id: bigint, input: Partial<Omit<BlogInput, "userProfileId">>) {
  await getBlogPostById(id);
  return prisma.blogPost.update({
    where: { id },
    data: input,
  });
}

export async function deleteBlogPost(id: bigint) {
  await getBlogPostById(id);
  await prisma.blogPost.delete({ where: { id } });
}
