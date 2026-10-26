import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedChat, readUpdateChatId } from "@/lib/telegram/allowlist";

const OPERATOR = "435400241";

test("a message from the operator chat is allowed", () => {
  const update = { message: { chat: { id: 435400241 } } };
  assert.equal(readUpdateChatId(update), 435400241);
  assert.equal(isAllowedChat(readUpdateChatId(update), OPERATOR), true);
});

test("a message from any other chat is ignored", () => {
  const update = { message: { chat: { id: 999 } } };
  assert.equal(isAllowedChat(readUpdateChatId(update), OPERATOR), false);
});

test("an inline-button callback is judged by the chat the button was sent to", () => {
  const update = { callback_query: { message: { chat: { id: 435400241 } } } };
  assert.equal(readUpdateChatId(update), 435400241);
  assert.equal(isAllowedChat(readUpdateChatId(update), OPERATOR), true);

  const stranger = { callback_query: { message: { chat: { id: 1 } } } };
  assert.equal(isAllowedChat(readUpdateChatId(stranger), OPERATOR), false);
});

test("an update without a chat is not allowed", () => {
  assert.equal(readUpdateChatId({}), null);
  assert.equal(readUpdateChatId({ callback_query: {} }), null);
  assert.equal(isAllowedChat(null, OPERATOR), false);
});

test("an unconfigured or unparsable allowlist fails closed", () => {
  assert.equal(isAllowedChat(435400241, null), false);
  assert.equal(isAllowedChat(435400241, ""), false);
  assert.equal(isAllowedChat(435400241, "not-a-number"), false);
  assert.equal(isAllowedChat(435400241, ` ${OPERATOR} `), true);
});
