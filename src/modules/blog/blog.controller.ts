import type { Request, Response } from "express";
import { z } from "zod";
import * as blogService from "./blog.service";
import { getProfileId } from "../profile/profile.service";
import { parseId } from "../../utils/parseId";
import { parsePagination, paginationSkipTake, buildPaginatedResponse } from "../../utils/pagination";
import { generateUniqueSlug } from "../../utils/slugify";
import { ConflictError } from "../../utils/httpError";

export async function listBlogHandler(req: Request, res: Response) {
  const params = parsePagination(req.query, 10);
  const { items, total } = await blogService.listBlogPosts(paginationSkipTake(params));
  res.json({ data: buildPaginatedResponse(items, total, params) });
}

export async function getBlogHandler(req: Request, res: Response) {
  const post = await blogService.getBlogPostBySlug(req.params.slug as string);
  res.json({ data: post });
}

const blogCreateSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  tags: z.string().nullable().optional(),
  slug: z.string().optional(),
});

export async function createBlogHandler(req: Request, res: Response) {
  const input = blogCreateSchema.parse(req.body);
  const userProfileId = await getProfileId();

  const providedSlug = input.slug?.trim();
  let slug: string;
  if (providedSlug) {
    if (await blogService.slugExists(providedSlug)) {
      throw ConflictError("Slug already in use");
    }
    slug = providedSlug;
  } else {
    slug = await generateUniqueSlug(input.title, (candidate) => blogService.slugExists(candidate));
  }

  const created = await blogService.createBlogPost({
    title: input.title,
    content: input.content,
    tags: input.tags,
    slug,
    userProfileId,
  });
  res.status(201).json({ data: created });
}

const blogUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  tags: z.string().nullable().optional(),
  slug: z.string().optional(),
});

export async function updateBlogHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const input = blogUpdateSchema.parse(req.body);
  const existing = await blogService.getBlogPostById(id);

  // Only touch the slug when the request body explicitly includes a "slug"
  // key: an empty string means "regenerate from the title", a non-empty
  // string is used verbatim (after a uniqueness check), and an omitted key
  // leaves the existing slug untouched so existing links don't break.
  let slug: string | undefined;
  if (Object.prototype.hasOwnProperty.call(req.body, "slug")) {
    const rawSlug = typeof req.body.slug === "string" ? req.body.slug.trim() : "";
    if (rawSlug === "") {
      const titleForSlug = input.title ?? existing.title;
      slug = await generateUniqueSlug(titleForSlug, (candidate) => blogService.slugExists(candidate, id));
    } else {
      if (await blogService.slugExists(rawSlug, id)) {
        throw ConflictError("Slug already in use");
      }
      slug = rawSlug;
    }
  }

  const updated = await blogService.updateBlogPost(id, {
    ...input,
    ...(slug !== undefined ? { slug } : {}),
  });
  res.json({ data: updated });
}

export async function deleteBlogHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  await blogService.deleteBlogPost(id);
  res.status(204).send();
}
