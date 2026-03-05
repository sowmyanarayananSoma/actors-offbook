/**
 * Generates a simple unique ID (timestamp + random).
 * For Phase 1 local-only use. Replace with uuid in Phase 3.
 */
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
