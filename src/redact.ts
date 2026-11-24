const PATTERNS: [RegExp, string][] = [
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "<github-token>"],
  [/\bpcsk_[A-Za-z0-9_]{20,}\b/g, "<pinecone-key>"],
  [/\bapikey_[A-Za-z0-9_]{20,}\b/g, "<api-key>"],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, "<api-key>"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "<aws-access-key>"],
  [/\b[\w-]+\/\d+\/[0-9a-f]{16,}\/[0-9a-f]{32,}\b/g, "<sprites-token>"],
  [/\b(Bearer|token)\s+[A-Za-z0-9._~+/=-]{16,}/gi, "$1 <redacted>"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "<private-key>"],
  [/\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY)[A-Z0-9_]*)=\S+/g, "$1=<redacted>"],
];

/** Masks credential-shaped strings before anything is logged, stored or posted. */
export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}
