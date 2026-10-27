import assert from "node:assert/strict";
import test from "node:test";

import { buildIngestRequest } from "../workers/src/radar/scanner";

const SOURCE = { id: "aaaa1111-1111-4111-8111-111111111111" };
const POST = {
  postUrl: "https://www.facebook.com/groups/me-bim-vn/posts/1",
  content: "Mình đang tìm máy hút sữa điện đôi.",
  images: ["https://scontent.example/a.jpg"]
};

test("every capture asks the API for the draft", () => {
  // The draft used to be opt-in and the worker never asked, so captures reached the
  // approval queue with nothing to approve. The API only runs Gemini for posts that
  // cleared the match threshold, so asking always is one call per accepted post.
  assert.equal(buildIngestRequest(SOURCE, POST, null).draft, true);
});

test("no pinned product means no productId, so the API matches with AI", () => {
  const request = buildIngestRequest(SOURCE, POST, null);
  assert.equal("productId" in request, false);
  assert.equal(request.draft, true);
});

test("a pinned product is forwarded (the no-Gemini path)", () => {
  const request = buildIngestRequest(SOURCE, POST, "bbbb1111-1111-4111-8111-111111111111");
  assert.equal(request.productId, "bbbb1111-1111-4111-8111-111111111111");
});

test("the scraped post is forwarded verbatim", () => {
  assert.deepEqual(buildIngestRequest(SOURCE, POST, null), {
    sourceId: SOURCE.id,
    postUrl: POST.postUrl,
    postContent: POST.content,
    postImages: POST.images,
    draft: true
  });
});
