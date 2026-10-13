// The pure half of the mail sender: a `mail` document (the Trigger Email extension's shape, which firestore.rules
// "Outgoing mail" enforces) into nodemailer's message options, and an SMTP URI plus password into transport options.

const list = (value) => (Array.isArray(value) ? value : value ? [value] : []).filter((v) => typeof v === "string" && v.includes("@"));

/** nodemailer options for a mail document; throws on a document that can't be sent. */
export function messageFor(doc, defaults) {
  const to = list(doc?.to), message = doc?.message ?? {};
  if (!to.length) throw new Error("No recipient");
  if (typeof message.subject !== "string" || !message.subject) throw new Error("No subject");
  if (typeof message.text !== "string" && typeof message.html !== "string") throw new Error("No body");
  return {
    from: doc.from ?? defaults.from,
    replyTo: doc.replyTo ?? defaults.replyTo,
    to, cc: list(doc.cc), bcc: list(doc.bcc),
    subject: message.subject,
    text: message.text,
    html: message.html,
  };
}

/** smtps://user@host:465 (implicit TLS) or smtp://user@host:587 (STARTTLS), with the password kept out of the URI. */
export function transportFor(uri, password) {
  const u = new URL(uri);
  const secure = u.protocol === "smtps:";
  return {
    host: u.hostname,
    port: Number(u.port) || (secure ? 465 : 587),
    secure,
    auth: u.username ? { user: decodeURIComponent(u.username), pass: password } : undefined,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  };
}
