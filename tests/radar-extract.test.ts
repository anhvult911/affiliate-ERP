import assert from "node:assert/strict";
import test from "node:test";

import { normaliseScrapedPosts, type RawPostCandidate } from "../workers/src/radar/targets.js";

const BASE = "https://www.facebook.com/groups/123456789";

function candidate(partial: Partial<RawPostCandidate>): RawPostCandidate {
  return { href: null, text: "", images: [], ...partial };
}

test("a relative permalink becomes absolute and keeps the post body", () => {
  const posts = normaliseScrapedPosts(
    [candidate({ href: "/groups/123456789/posts/987654/", text: "Bé nhà mình 8 tháng, đang tìm máy hâm sữa" })],
    BASE
  );

  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.postUrl, "https://www.facebook.com/groups/123456789/posts/987654/");
  assert.match(posts[0]?.content ?? "", /máy hâm sữa/);
});

test("the repeated 'Facebook' label that textContent drags in is stripped", () => {
  // Live feed text starts with dozens of these tokens, concatenated without spaces.
  const posts = normaliseScrapedPosts(
    [
      candidate({
        href: "/groups/1/posts/2/",
        text: "FacebookFacebookFacebookFacebookFacebook Hội mẹ bỉm chia sẻ kinh nghiệm"
      })
    ],
    BASE
  );

  assert.equal(posts[0]?.content, "Hội mẹ bỉm chia sẻ kinh nghiệm");
});

test("a genuine single mention of Facebook is left alone", () => {
  const posts = normaliseScrapedPosts(
    [candidate({ href: "/groups/1/posts/2/", text: "Mình mua qua Facebook Marketplace, hàng tốt" })],
    BASE
  );
  assert.match(posts[0]?.content ?? "", /Facebook Marketplace/);
});

test("non-permalink anchors (author profile links) are not posts", () => {
  const posts = normaliseScrapedPosts(
    [candidate({ href: "/groups/123456789/user/100037624492877/", text: "Kim Tiến clothes 24 phút trước" })],
    BASE
  );
  assert.deepEqual(posts, []);
});

test("a lazy placeholder with neither text nor images is dropped", () => {
  assert.deepEqual(normaliseScrapedPosts([candidate({ href: "/groups/1/posts/2/", text: "   " })], BASE), []);
});

test("the same post captured twice collapses to one entry", () => {
  const twice = normaliseScrapedPosts(
    [
      candidate({ href: "/groups/1/posts/2/", text: "first read" }),
      candidate({ href: "https://www.facebook.com/groups/1/posts/2/", text: "second read" })
    ],
    BASE
  );
  assert.equal(twice.length, 1);
  assert.equal(twice[0]?.content, "first read");
});

test("images are de-duplicated and capped at four", () => {
  const posts = normaliseScrapedPosts(
    [
      candidate({
        href: "/groups/1/posts/2/",
        text: "set đồ sơ sinh",
        images: ["https://s1.jpg", "https://s1.jpg", "https://s2.jpg", "https://s3.jpg", "https://s4.jpg", "https://s5.jpg"]
      })
    ],
    BASE
  );
  assert.deepEqual(posts[0]?.images, ["https://s1.jpg", "https://s2.jpg", "https://s3.jpg", "https://s4.jpg"]);
});
