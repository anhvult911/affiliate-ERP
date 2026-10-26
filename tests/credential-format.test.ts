import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultAccountName,
  parseAccountLines,
  parseProxy
} from "@/lib/accounts/credential-format";

const SECRET = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

test("parses the operator's export line", () => {
  const { accounts, issues } = parseAccountLines(
    `00000000000000|matkhau|${SECRET}|127.0.0.1:8080`
  );

  assert.equal(issues.length, 0);
  assert.deepEqual(accounts[0], {
    line: 1,
    identifier: "00000000000000",
    password: "matkhau",
    twofaSecret: SECRET,
    proxy: { host: "127.0.0.1", port: 8080, username: null, password: null }
  });
});

test("proxy without credentials is valid; a bad port is not", () => {
  assert.deepEqual(parseProxy("1.2.3.4:8080"), {
    host: "1.2.3.4",
    port: 8080,
    username: null,
    password: null
  });
  assert.equal(parseProxy("1.2.3.4:70000"), null);
  assert.equal(parseProxy("1.2.3.4:8080:user"), null);
  assert.equal(parseProxy("not a proxy"), null);
});

test("one bad line does not lose the rest of the paste", () => {
  const { accounts, issues } = parseAccountLines(
    [
      `111111111|pass-one|${SECRET}`,
      "222222222|pass-two|not-a-secret",
      "333333333|pass-three",
      `444444444|pass-four|${SECRET}|1.2.3.4:99999`
    ].join("\n")
  );

  assert.deepEqual(accounts.map((account) => account.identifier), ["111111111"]);
  assert.deepEqual(issues.map((issue) => issue.line), [2, 3, 4]);
});

test("duplicate UIDs inside one paste are reported, not imported twice", () => {
  const { accounts, issues } = parseAccountLines(
    [`111111111|pass|${SECRET}`, `111111111|other|${SECRET}`].join("\n")
  );

  assert.equal(accounts.length, 1);
  assert.match(issues[0]?.error ?? "", /Trùng UID/);
});

test("blank lines and comments are ignored, keeping line numbers honest", () => {
  const { accounts, issues } = parseAccountLines(
    ["# danh sách tháng 10", "", `111111111|pass|${SECRET}`].join("\n")
  );

  assert.equal(issues.length, 0);
  assert.equal(accounts[0]?.line, 3);
});

test("a short UID is rejected — phone numbers are what the export contains", () => {
  const { issues } = parseAccountLines(`u4|pass|${SECRET}`);
  assert.match(issues[0]?.error ?? "", /UID/);
});

test("default name keeps the tail of the UID, which is what distinguishes accounts", () => {
  assert.equal(defaultAccountName("00000000000000"), "FB 000000");
});
