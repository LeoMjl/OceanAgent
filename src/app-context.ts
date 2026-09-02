import { loadConfig, type AppConfig } from "./config.js";
import { OceanAgentRunner } from "./agent/agent-runner.js";
import { OceanSessionFactory } from "./agent/session-factory.js";
import { ConversationRepository } from "./db/conversation-repository.js";
import { OceanDatabase } from "./db/database.js";
import { PlanRepository } from "./db/plan-repository.js";
import { ProjectRepository } from "./db/project-repository.js";
import { RunRepository } from "./db/run-repository.js";
import { RunEventBus } from "./events/run-event-bus.js";
import { RagService } from "./rag/rag-service.js";
import { RagStore } from "./rag/rag-store.js";
import { OfficialWebSearch } from "./web-search.js";
import { ProjectCredentialVault } from "./projects/project-credential-vault.js";
import { RemoteConnectionRepository } from "./db/remote-connection-repository.js";
import { DpapiSecretProtector } from "./security/dpapi-secret-protector.js";
import { ModelSettingsRepository } from "./db/model-settings-repository.js";
import { OceanModelService } from "./agent/model-service.js";
import { OCEAN_DASHSCOPE_PROVIDER_ID } from "./agent/model-defaults.js";

export interface AppContext {
  config: AppConfig;
  database: OceanDatabase;
  conversations: ConversationRepository;
  projects: ProjectRepository;
  runs: RunRepository;
  plans: PlanRepository;
  events: RunEventBus;
  rag: RagService;
  projectCredentials: ProjectCredentialVault;
  remoteConnections: RemoteConnectionRepository;
  models: OceanModelService;
  runner: OceanAgentRunner;
  close(): void;
}

export async function createAppContext(config = loadConfig()): Promise<AppContext> {
  const database = new OceanDatabase(config.databasePath, config.rootDir);
  const projects = new ProjectRepository(database);
  projects.ensureDefault();
  const conversations = new ConversationRepository(database);
  const runs = new RunRepository(database);
  runs.redactStoredSecrets();
  const plans = new PlanRepository(database);
  const events = new RunEventBus(runs);
  const projectCredentials = new ProjectCredentialVault();
  const protector = new DpapiSecretProtector();
  const remoteConnections = new RemoteConnectionRepository(database, protector);
  const modelSettings = new ModelSettingsRepository(database, protector);
  const rag = new RagService(
    new RagStore(database),
    modelSettings.getEmbeddingSettings(),
    () => modelSettings.getApiKey(OCEAN_DASHSCOPE_PROVIDER_ID),
    () => Boolean(modelSettings.getProvider(OCEAN_DASHSCOPE_PROVIDER_ID)?.hasSavedCredential),
  );
  const models = await OceanModelService.create(modelSettings);
  const sessions = await OceanSessionFactory.create(config, models);
  const runner = new OceanAgentRunner(
    config,
    sessions,
    conversations,
    runs,
    plans,
    events,
    rag,
    new OfficialWebSearch(),
    projects,
    projectCredentials,
    remoteConnections,
  );
  return {
    config,
    database,
    projects,
    conversations,
    runs,
    plans,
    events,
    rag,
    projectCredentials,
    remoteConnections,
    models,
    runner,
    close: () => {
      projectCredentials.clear();
      database.close();
    },
  };
}
