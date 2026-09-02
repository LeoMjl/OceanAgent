export const OCEAN_DASHSCOPE_PROVIDER_ID = "dashscope-ocean";
export const OCEAN_DASHSCOPE_PROVIDER_NAME = "Alibaba Cloud Model Studio";
export const OCEAN_DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
export const OCEAN_DEFAULT_CHAT_MODEL = "qwen3.7-plus";

export interface EmbeddingModelSettings {
  providerId: string;
  baseUrl: string;
  modelId: string;
  dimensions: number;
}

export const OCEAN_DEFAULT_EMBEDDING_SETTINGS: EmbeddingModelSettings = {
  providerId: OCEAN_DASHSCOPE_PROVIDER_ID,
  baseUrl: OCEAN_DASHSCOPE_BASE_URL,
  modelId: "qwen3.7-text-embedding",
  dimensions: 1024,
};
