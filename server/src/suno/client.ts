// Suno 連携の抽象化レイヤ。公式 API が出たら実装を差し替える
// (調査結果: docs/specs/suno-api.md)

export interface GenerateParams {
  prompt: string;
  instrumental: boolean;
  model: string;
}

export interface SunoTrack {
  id: string;
  title: string;
  duration: number;
  audioUrl: string;
  imageUrl: string | null;
}

// done になるまでポーリングし、done なら tracks が入る。failed は理由を error に持つ
export interface SunoTaskState {
  status: string;
  done: boolean;
  failed: boolean;
  tracks: SunoTrack[];
  error: string | null;
}

export interface SunoClient {
  readonly provider: string;
  createTask(params: GenerateParams): Promise<string>;
  getTask(providerTaskId: string): Promise<SunoTaskState>;
  getCredits(): Promise<number | null>;
}
