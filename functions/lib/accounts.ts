export interface AccountRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

export interface AccountSessionRow {
  id: string;
  account_id: string;
  created_at: string;
  expires_at: string;
}

export interface SavedDesignRow {
  id: string;
  account_id: string;
  template_id: string;
  name: string | null;
  configuration: string;
  created_at: string;
  updated_at: string;
}

export interface SavedDesignDTO {
  id: string;
  templateId: string;
  name: string | null;
  configuration: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export function toSavedDesignDTO(row: SavedDesignRow): SavedDesignDTO {
  return {
    id: row.id,
    templateId: row.template_id,
    name: row.name,
    configuration: JSON.parse(row.configuration),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
