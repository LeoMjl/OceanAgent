import type { ModelCatalogSource, ModelReference } from "../contracts.js";
import {
  OCEAN_DEFAULT_EMBEDDING_SETTINGS,
  type EmbeddingModelSettings,
} from "../agent/model-defaults.js";
import type { SecretProtector } from "../security/dpapi-secret-protector.js";
import { OceanDatabase } from "./database.js";

interface ProviderRow {
  provider_id: string;
  secret_ciphertext: string | null;
  enabled_models_json: string;
  catalog_json: string;
  catalog_source: string | null;
  catalog_discovered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoredCatalogModel {
  id: string;
  name: string;
  api?: string;
  baseUrl?: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
  samplingParams?: Record<string, unknown>;
  headers?: Record<string, string>;
  compat?: unknown;
}

export interface StoredModelCatalog {
  source: ModelCatalogSource;
  discoveredAt: string;
  models: StoredCatalogModel[];
}

export interface StoredProviderSettings {
  providerId: string;
  hasSavedCredential: boolean;
  enabledModelIds: string[];
  catalog: StoredModelCatalog | null;
  createdAt: string;
  updatedAt: string;
}

function now(): string {
  return new Date().toISOString();
}

function parseIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseCatalog(row: ProviderRow): StoredModelCatalog | null {
  if (!row.catalog_source || !row.catalog_discovered_at) return null;
  try {
    const models = JSON.parse(row.catalog_json) as unknown;
    if (!Array.isArray(models)) return null;
    return {
      source: row.catalog_source === "remote" ? "remote" : "pi_catalog",
      discoveredAt: row.catalog_discovered_at,
      models: models as StoredCatalogModel[],
    };
  } catch {
    return null;
  }
}

function mapRow(row: ProviderRow): StoredProviderSettings {
  return {
    providerId: row.provider_id,
    hasSavedCredential: Boolean(row.secret_ciphertext),
    enabledModelIds: parseIds(row.enabled_models_json),
    catalog: parseCatalog(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ModelSettingsRepository {
  constructor(
    private readonly db: OceanDatabase,
    private readonly protector: SecretProtector,
  ) {}

  listProviders(): StoredProviderSettings[] {
    return (this.db.raw.prepare(
      "SELECT * FROM model_provider_settings ORDER BY updated_at DESC",
    ).all() as ProviderRow[]).map(mapRow);
  }

  getProvider(providerId: string): StoredProviderSettings | null {
    const row = this.db.raw.prepare(
      "SELECT * FROM model_provider_settings WHERE provider_id = ?",
    ).get(providerId) as ProviderRow | undefined;
    return row ? mapRow(row) : null;
  }

  async getApiKey(providerId: string): Promise<string | null> {
    const row = this.db.raw.prepare(
      "SELECT secret_ciphertext FROM model_provider_settings WHERE provider_id = ?",
    ).get(providerId) as { secret_ciphertext: string | null } | undefined;
    return row?.secret_ciphertext ? this.protector.unprotect(row.secret_ciphertext) : null;
  }

  async saveProvider(
    providerId: string,
    enabledModelIds: string[],
    apiKey?: string,
    catalog?: StoredModelCatalog,
  ): Promise<StoredProviderSettings> {
    const existing = this.db.raw.prepare(
      "SELECT * FROM model_provider_settings WHERE provider_id = ?",
    ).get(providerId) as ProviderRow | undefined;
    const timestamp = now();
    const ciphertext = apiKey ? await this.protector.protect(apiKey) : existing?.secret_ciphertext ?? null;
    const savedCatalog = catalog ?? (existing ? parseCatalog(existing) : null);
    this.db.raw.prepare(`
      INSERT INTO model_provider_settings (
        provider_id, secret_ciphertext, enabled_models_json, catalog_json,
        catalog_source, catalog_discovered_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_id) DO UPDATE SET
        secret_ciphertext = excluded.secret_ciphertext,
        enabled_models_json = excluded.enabled_models_json,
        catalog_json = excluded.catalog_json,
        catalog_source = excluded.catalog_source,
        catalog_discovered_at = excluded.catalog_discovered_at,
        updated_at = excluded.updated_at
    `).run(
      providerId,
      ciphertext,
      JSON.stringify(enabledModelIds),
      JSON.stringify(savedCatalog?.models ?? []),
      savedCatalog?.source ?? null,
      savedCatalog?.discoveredAt ?? null,
      existing?.created_at ?? timestamp,
      timestamp,
    );
    return this.getProvider(providerId)!;
  }

  getDefaultModel(): ModelReference | null {
    const row = this.db.raw.prepare(
      "SELECT value FROM app_settings WHERE key = 'default_model'",
    ).get() as { value: string } | undefined;
    if (!row) return null;
    try {
      const value = JSON.parse(row.value) as ModelReference;
      return value.providerId && value.modelId ? value : null;
    } catch {
      return null;
    }
  }

  setDefaultModel(model: ModelReference): void {
    this.db.raw.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES ('default_model', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(JSON.stringify(model), now());
  }

  getEmbeddingSettings(): EmbeddingModelSettings {
    const row = this.db.raw.prepare(
      "SELECT value FROM app_settings WHERE key = 'embedding_model_settings'",
    ).get() as { value: string } | undefined;
    if (row) {
      try {
        const value = JSON.parse(row.value) as Partial<EmbeddingModelSettings>;
        if (value.providerId && value.baseUrl && value.modelId
          && Number.isInteger(value.dimensions) && Number(value.dimensions) > 0) {
          return {
            providerId: value.providerId,
            baseUrl: value.baseUrl.replace(/\/$/, ""),
            modelId: value.modelId,
            dimensions: Number(value.dimensions),
          };
        }
      } catch {
        // Invalid legacy values are replaced by the application default below.
      }
    }
    this.setEmbeddingSettings(OCEAN_DEFAULT_EMBEDDING_SETTINGS);
    return { ...OCEAN_DEFAULT_EMBEDDING_SETTINGS };
  }

  setEmbeddingSettings(settings: EmbeddingModelSettings): void {
    this.db.raw.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES ('embedding_model_settings', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(JSON.stringify(settings), now());
  }
}
