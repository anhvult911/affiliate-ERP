import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Logger } from "./logger.js";

/**
 * Local stand-in for Facebook, for the paths the worker touches.
 *
 * Three views, because the worker has three behaviours:
 *   /timeline?as=X   an account's own wall — where warming publishes lifestyle posts
 *   /post/group      the radar's group post — where comments and link replies land
 *   /post/<id>       a lifestyle post — where another account cross-warms
 *
 * It is stateful on purpose: two browser profiles must see the same content, which
 * is the only way the 2-tier reply and cross-warming are testable without posting
 * in public. Nothing here is used in production runs.
 */

export type FixtureReply = { id: string; author: string; text: string; at: string };

export type FixtureComment = {
  id: string;
  author: string;
  text: string;
  attachment: string | null;
  at: string;
  replies: FixtureReply[];
};

export type FixturePost = {
  id: string;
  author: string;
  text: string;
  at: string;
  comments: FixtureComment[];
};

export type FixtureServer = {
  url: string;
  state(): FixturePost[];
  profile(): { avatar: string | null; cover: string | null; bio: string };
  stop(): Promise<void>;
};

const GROUP_POST_ID = "group";

export async function startFixtureServer(logger: Logger, port = 0): Promise<FixtureServer> {
  const here = dirname(fileURLToPath(import.meta.url));
  const pagePath = join(here, "..", "fixtures", "comment-page.html");
  const page = await readFile(pagePath, "utf8");
  const profilePage = await readFile(join(here, "..", "fixtures", "profile-page.html"), "utf8");

  let counter = 0;
  // What a visitor sees on the profile: exactly the three things profile_setup sets.
  const profile: { avatar: string | null; cover: string | null; bio: string } = {
    avatar: null,
    cover: null,
    bio: ""
  };
  const posts: FixturePost[] = [
    {
      id: GROUP_POST_ID,
      author: "Hội Mẹ Bỉm Sữa Săn Deal",
      text: "Có mẹ nào biết máy hút sữa nào hút êm mà pin lâu không ạ? Bé nhà mình bú ít nên phải hút nhiều lần.",
      at: new Date().toISOString(),
      comments: []
    }
  ];

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const json = (body: unknown, status = 200) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/timeline")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(page);
      return;
    }

    if (request.method === "GET" && url.pathname === "/profile") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(profilePage);
      return;
    }

    if (request.method === "GET" && url.pathname === "/profile/state") {
      return json({ ...profile, ready: Boolean(profile.avatar && profile.cover && profile.bio) });
    }

    if (request.method === "POST" && url.pathname === "/profile/asset") {
      const body = await readJson(request);
      const kind = readStringField(body, "kind");
      const dataUrl = readStringField(body, "dataUrl");

      if ((kind !== "avatar" && kind !== "cover") || !dataUrl?.startsWith("data:image/")) {
        return json({ ok: false, error: "expected kind=avatar|cover and an image data URL" }, 400);
      }

      profile[kind] = dataUrl;
      logger.debug("fixture: profile asset stored", { kind, bytes: dataUrl.length });
      return json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/profile/bio") {
      const body = await readJson(request);
      profile.bio = readStringField(body, "bio") ?? "";
      logger.debug("fixture: profile bio stored", { length: profile.bio.length });
      return json({ ok: true });
    }

    if (request.method === "GET" && url.pathname.startsWith("/post/")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(page);
      return;
    }

    if (request.method === "GET" && url.pathname === "/state") {
      const postId = url.searchParams.get("post");
      if (!postId) return json({ posts: posts.map(({ comments, ...rest }) => ({ ...rest, commentCount: comments.length })) });

      const post = posts.find((entry) => entry.id === postId);
      return json(post ? { post: { ...post, comments: undefined }, comments: post.comments } : { post: null, comments: [] });
    }

    if (request.method === "POST" && url.pathname === "/post") {
      const body = await readJson(request);
      const author = readStringField(body, "author") ?? "anonymous";
      const text = readStringField(body, "text") ?? "";

      if (text.trim().length > 0) {
        counter += 1;
        const created: FixturePost = {
          id: `p${counter}`,
          author,
          text,
          at: new Date().toISOString(),
          comments: []
        };
        posts.unshift(created);
        logger.debug("fixture: lifestyle post stored", { author, id: created.id });
        return json({ ok: true, id: created.id, url: `/post/${created.id}` });
      }

      return json({ ok: false, error: "empty post" }, 400);
    }

    if (request.method === "POST" && url.pathname === "/comment") {
      const body = await readJson(request);
      const author = readStringField(body, "author") ?? "anonymous";
      const text = readStringField(body, "text") ?? "";
      const postId = readStringField(body, "postId") ?? GROUP_POST_ID;
      const parentId = readStringField(body, "parentId");
      const attachment = readStringField(body, "attachment");

      const post = posts.find((entry) => entry.id === postId);
      if (!post) return json({ ok: false, error: "unknown post" }, 404);

      if (text.trim().length > 0) {
        counter += 1;
        if (parentId) {
          const parent = post.comments.find((comment) => comment.id === parentId);
          parent?.replies.push({ id: `r${counter}`, author, text, at: new Date().toISOString() });
        } else {
          post.comments.unshift({
            id: `c${counter}`,
            author,
            text,
            attachment,
            at: new Date().toISOString(),
            replies: []
          });
        }
        logger.debug("fixture: comment stored", { author, postId, parentId });
      }

      return json({ ok: true });
    }

    response.writeHead(404);
    response.end("not found");
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const url = `http://127.0.0.1:${actualPort}`;

  logger.info("fixture server listening", { url, groupPost: `${url}/post/${GROUP_POST_ID}` });

  return {
    url,
    state: () => posts,
    profile: () => ({ ...profile }),
    stop: () => stopServer(server)
  };
}

async function readJson(request: AsyncIterable<Buffer | string>): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) return null;

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Reads one string field off an unvalidated JSON body. */
function readStringField(body: unknown, field: string): string | null {
  if (typeof body !== "object" || body === null || !(field in body)) return null;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stopServer(server: Server): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  server.close(() => resolve());
  return promise;
}
