// kie.ai(sunoapi.org と同一 API 構造)の SunoClient 実装。Bearer 認証
import type {
  GenerateParams,
  SunoClient,
  SunoTaskState,
  SunoTrack,
} from "./client.ts";

// callBackUrl はスキーマ上必須だが、完了検知はポーリングで行うためプレースホルダを渡す
const PLACEHOLDER_CALLBACK = "https://example.com/suno-callback";

const FAILURE_STATUSES = [
  "CREATE_TASK_FAILED",
  "GENERATE_AUDIO_FAILED",
  "SENSITIVE_WORD_ERROR",
];

interface ApiEnvelope {
  code: number;
  msg?: string;
  data?: unknown;
}

interface RecordInfo {
  status: string;
  errorMessage?: string;
  response?: {
    sunoData?: Array<{
      id: string;
      title?: string;
      duration?: number;
      audioUrl?: string;
      imageUrl?: string;
    }>;
  };
}

export class KieAiClient implements SunoClient {
  readonly provider: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.provider = new URL(baseUrl).hostname;
  }

  private async api(method: string, pathname: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => null)) as ApiEnvelope | null;
    if (!res.ok || !json || json.code !== 200) {
      throw new Error(
        `${method} ${pathname} failed: HTTP ${res.status} / ${JSON.stringify(json)}`
      );
    }
    return json.data;
  }

  async createTask(params: GenerateParams): Promise<string> {
    const data = (await this.api("POST", "/api/v1/generate", {
      customMode: false,
      instrumental: params.instrumental,
      model: params.model,
      prompt: params.prompt,
      callBackUrl: PLACEHOLDER_CALLBACK,
    })) as { taskId: string };
    return data.taskId;
  }

  async getTask(providerTaskId: string): Promise<SunoTaskState> {
    const record = (await this.api(
      "GET",
      `/api/v1/generate/record-info?taskId=${encodeURIComponent(providerTaskId)}`
    )) as RecordInfo;

    const tracks: SunoTrack[] = (record.response?.sunoData ?? [])
      .filter((t) => t.audioUrl)
      .map((t) => ({
        id: t.id,
        title: t.title || "(無題)",
        duration: t.duration ?? 0,
        audioUrl: t.audioUrl!,
        imageUrl: t.imageUrl ?? null,
      }));

    // コールバック失敗は生成自体の失敗ではない。データがあれば成功扱い
    const done =
      record.status === "SUCCESS" ||
      (record.status === "CALLBACK_EXCEPTION" && tracks.length > 0);
    const failed =
      FAILURE_STATUSES.includes(record.status) ||
      (record.status === "CALLBACK_EXCEPTION" && tracks.length === 0);

    return {
      status: record.status,
      done,
      failed,
      tracks,
      error: failed ? record.errorMessage ?? record.status : null,
    };
  }

  // クレジット確認のパスはプロバイダで異なる(sunoapi.org: /generate/credit、kie.ai: /chat/credit)
  async getCredits(): Promise<number | null> {
    for (const pathname of ["/api/v1/chat/credit", "/api/v1/generate/credit"]) {
      try {
        return (await this.api("GET", pathname)) as number;
      } catch {
        // 次の候補を試す
      }
    }
    return null;
  }
}
