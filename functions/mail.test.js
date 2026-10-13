import assert from "node:assert/strict";
import test from "node:test";
import { messageFor, transportFor } from "./mail.js";

const defaults = { from: "RTS AI <info@example.com>", replyTo: "team@example.com" };

test("a mail document becomes a nodemailer message with the default sender", () => {
  const m = messageFor({ to: ["rtsai@googlegroups.com"], message: { subject: "[RTS AI] New player", text: "Hi", html: "<p>Hi</p>" } }, defaults);
  assert.deepEqual(m, { from: defaults.from, replyTo: defaults.replyTo, to: ["rtsai@googlegroups.com"], cc: [], bcc: [], subject: "[RTS AI] New player", text: "Hi", html: "<p>Hi</p>" });
  assert.deepEqual(messageFor({ to: "a@example.com", bcc: "b@example.com", message: { subject: "s", text: "t" } }, defaults).bcc, ["b@example.com"]);
});

test("documents that can't be sent are refused", () => {
  assert.throws(() => messageFor({ message: { subject: "s", text: "t" } }, defaults), /No recipient/);
  assert.throws(() => messageFor({ to: ["not-an-address"], message: { subject: "s", text: "t" } }, defaults), /No recipient/);
  assert.throws(() => messageFor({ to: ["a@example.com"], message: { text: "t" } }, defaults), /No subject/);
  assert.throws(() => messageFor({ to: ["a@example.com"], message: { subject: "s" } }, defaults), /No body/);
});

test("SMTP URIs map to implicit TLS or STARTTLS, with the password outside the URI", () => {
  assert.deepEqual(transportFor("smtps://humanque@mail.example.net:465", "pw"), { host: "mail.example.net", port: 465, secure: true, auth: { user: "humanque", pass: "pw" }, connectionTimeout: 20000, greetingTimeout: 15000, socketTimeout: 30000 });
  const starttls = transportFor("smtp://user%40example.net@smtp.example.net", "pw");
  assert.equal(starttls.port, 587); assert.equal(starttls.secure, false); assert.equal(starttls.auth.user, "user@example.net");
});
