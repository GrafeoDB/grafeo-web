// isMutatingQuery was removed intentionally. The regex only checked the first
// token of a query, so multi-clause mutations like "MATCH (n) DELETE n" were
// missed, causing silent data loss when persistence was enabled. Rather than
// trying to maintain an ever-growing pattern list, we now always call
// scheduleSave after every execute(). The PersistenceManager debounce already
// coalesces saves (max 1/second), so the extra snapshots on read-only queries
// are harmless, while a missed save on a mutation means permanent data loss.
