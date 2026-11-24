import text from "./text.json" with { type: "json" };

export { text };

/** Replaces {name} placeholders in one pass, so inserted values are never expanded again. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
