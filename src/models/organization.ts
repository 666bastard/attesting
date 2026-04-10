/**
 * Represents an organization using Attesting.
 * Matches the `organizations` table in the database schema.
 */
export interface Organization {
  id: string;
  name: string;
  description?: string;
  cage_code?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Represents a product/system scope within an organization.
 * Matches the `scopes` table in the database schema.
 */
export interface Scope {
  id: string;
  org_id: string;
  name: string;
  description?: string;
  scope_type: 'product' | 'system' | 'service' | 'facility';
  created_at: string;
  updated_at: string;
}
