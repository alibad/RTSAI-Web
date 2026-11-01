/**
 * Who runs RTS AI and how to reach them, for /terms and /privacy. One place, because both pages must say the same.
 * DRAFT (1 November 2026): written for the owner's review, not legal advice. While `draft` is true both pages say so at
 * the top. The owner confirms or corrects every value marked "owner to confirm" and then sets `draft` to false.
 */
export const LEGAL = {
  draft: true,
  updated: "1 November 2026",
  /** Owner to confirm: the person or company that runs RTS AI and decides what happens to player data. */
  operator: "Human Quest",
  /** Owner to confirm: the mailbox for privacy and account questions (today the team email's sender address). */
  contactEmail: "info@humanquest.net",
  /** Owner to confirm: where the operator is based. */
  basedIn: "Doha, Qatar",
  /** Owner to confirm: the youngest age that may create an account. */
  minimumAge: 13,
  /** Owner to confirm: whose law applies to the terms. */
  governingLaw: "the State of Qatar",
} as const;
