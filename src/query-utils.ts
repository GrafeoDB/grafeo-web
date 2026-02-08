/** Detects queries that mutate the graph (INSERT, CREATE, DELETE, etc). */
export function isMutatingQuery(query: string): boolean {
  return /^\s*(INSERT|CREATE|DELETE|REMOVE|SET|MERGE|DROP)\b/i.test(query);
}
