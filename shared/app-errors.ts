export const APP_ERROR_MESSAGES = {
  accessRequired: "アクセス認証が必要です。ページを再読み込みしてログインしてください。",
  serviceRequestFailed: "ローカルサービスでリクエストを完了できませんでした。",
  serviceUnavailable: "ローカルサービスに接続できません。アプリが起動していることを確認して、もう一度お試しください。",
  serviceFailure: "ローカルサービスでエラーが発生しました。再試行してください",
  modelTooLarge: "モデルファイルは 30 MB 以下にしてください。",
  storageUnavailable: "ブラウザーのローカルストレージにアクセスできません。このサイトのデータ保存を許可して、もう一度お試しください。",
  credentialsUnreadable: "ブラウザーに保存した API キーを読み込めません。練習設定で保存し直すか、削除してください。",
  credentialsSaveFailed: "API キーを保存できませんでした。サイトの保存権限と空き容量を確認して、もう一度お試しください。",
  credentialsDeleteFailed: "API キーを削除できませんでした。サイトの保存権限を確認して、もう一度お試しください。",
  authenticationFailed: "Alibaba Cloud の認証に失敗しました。練習設定の API キーと接続先ドメインの組み合わせを確認してください。",
  modelAccessDenied: "このアカウントにはモデルのアクセス権がありません。モデルの有効化とリージョン、ワークスペースを確認してください。",
  quotaExceeded: "Alibaba Cloud の利用枠が不足しているか、リクエストが多すぎます。残高と利用枠を確認して再試行してください。",
  modelUnavailable: "選択したモデルがこのリージョンまたはワークスペースに見つかりません。サービス設定を確認してください。",
  providerRequestInvalid: "Alibaba Cloud がリクエスト設定を受け付けませんでした。リージョン、ワークスペース、モデル、音声を確認してください。",
  providerUnavailable: "Alibaba Cloud を一時的に利用できません。しばらくしてから再試行してください。",
  suggestionAudioFailed: "お手本の音声を生成できませんでした。Bailian の設定を確認して、もう一度お試しください。",
  suggestionNotFound: "返信候補が見つかりません。",
  suggestionInvalid: "この返信候補は読み上げられません。",
  credentialsRequired: "練習設定に Bailian API キーを入力し、接続先ドメインを確認してください。",
  suggestionBusy: "音声のリクエストが混み合っています。しばらくしてから再試行してください。",
  hostInvalid: "Bailian の接続先ドメインの形式が正しくありません。",
  hostNotAllowed: "Bailian 公式のパブリックドメインまたはワークスペース専用ドメインを入力してください。パス、ポート、試用ドメインは使用できません。",
  apiKeyRequired: "練習設定に Bailian API キーを入力してください。",
  apiKeyInvalid: "Bailian API キーの形式が正しくありません。",
  apiKeyCharacters: "Bailian API キーは空白を含まない 1～512 文字の半角英数字・記号で入力してください。",
  credentialsHeaderInvalid: "Bailian の認証ヘッダーが不足しているか、形式が正しくありません。",
  credentialsInvalid: "Bailian の設定形式が正しくありません。",
  configInvalid: "Bailian の設定が正しくありません。練習設定を確認してください。",
  payloadTooLarge: "ファイルまたはメッセージのサイズが大きすぎます",
  jsonRequired: "JSON 形式で送信してください",
  jsonInvalid: "JSON の形式が正しくありません",
  levelInvalid: "学習レベルが正しくありません",
  silenceInvalid: "発話後の待機時間は 200～6000 ミリ秒で指定してください",
  avatarSelectionInvalid: "読み込んだ VRM アバターを選択してください",
  vrmBinaryInvalid: "完全な VRM 1.0 バイナリファイルを選択してください",
  vrmDescriptionInvalid: "VRM の記述データが正しくないか、サイズが大きすぎます",
  vrmExternalResources: "モデルに外部リソースが含まれています。テクスチャとリソースを埋め込んだ VRM を書き出してください",
  vrmMetadataInvalid: "有効なメタデータを含む VRM 1.0 モデルを使用してください",
  localOnly: "この端末からのみアクセスできます",
  originDenied: "このページからローカルサービスへの接続は許可されていません",
  mutationDenied: "更新操作はこの端末のアプリから行ってください",
  settingsDuringSession: "現在の会話を終了してから設定を変更してください",
  sessionNotFound: "会話が見つかりません",
  messageNotFound: "メッセージが見つからないか、内容が空です",
  translationBusy: "解説のリクエストが混み合っています。しばらくしてから再試行してください",
  translationFailed: "解説を生成できませんでした。Bailian の設定、モデルのアクセス権、利用枠を確認して再試行してください",
  memoriesLimit: "メモは最大 200 件です。保存済みの内容を整理してください",
  memoryNotFound: "メモが見つかりません",
  avatarDuringSession: "会話を終了してからアバターを変更してください",
  vrmContentType: "バイナリ形式の VRM ファイルを使用してください",
  avatarNotFound: "アバターファイルが見つかりません。もう一度読み込んでください",
  apiNotFound: "指定された API が見つかりません",
  sessionFailure: "会話の処理に失敗しました。終了してから再接続してください",
  eventInvalid: "メッセージの形式が正しくないか、サイズ上限を超えています",
  reviewInvalid: "振り返りの形式が正しくありません。今回の会話履歴は保存されています。",
  reviewIncomplete: "振り返りの内容が不足しています。今回の会話履歴は保存されています。",
  sessionRequired: "先に会話を開始してください。",
  textInvalid: "1～4000 文字で入力してください。",
  sessionAlreadyActive: "現在の会話を終了してから、新しい会話を開始してください。",
  sessionOtherPage: "別のページで会話中です。そのページの会話を終了してください。",
  sessionStartFailed: "会話を開始できませんでした。会話履歴を選び直して再試行してください。",
  asrFallback: "音声認識を有効にできなかったため、テキストチャットに切り替えました。",
  ttsFailed: "音声合成に失敗しました。返信のテキストは確認できます。",
  replyEmpty: "表示できる返信が生成されませんでした。もう一度お試しください。",
  replyFailed: "返信を生成できませんでした。受信済みのテキストは保存されています。再試行してください。",
  reviewFailed: "振り返りを生成できませんでした。今回の会話履歴は保存されています。",
  asrNotReusable: "音声認識の接続は再利用できません。再接続してください。",
  asrNotConfigured: "音声認識が設定されていません。Bailian API キーと接続先ドメインを確認してください。",
  asrTimeout: "音声認識の接続がタイムアウトしました。テキストで会話を続けられます。",
  asrDataInvalid: "音声認識データに問題があります。再接続してください。",
  asrEnded: "音声認識が終了しました。テキストで会話を続けるか、再接続してください。",
  asrUnavailable: "音声認識に接続できませんでした。テキストで会話を続けるか、再接続してください。",
  asrDisconnected: "音声認識の接続が切れました。テキストで会話を続けるか、再接続してください。",
  asrBackpressure: "音声の送信が混み合っているため、認識を停止しました。再接続してください。",
  asrSendFailed: "音声を送信できませんでした。テキストで会話を続けるか、再接続してください。",
  asrCancelled: "音声認識の接続はキャンセルされました。",
  asrRequestFailed: "音声認識のリクエストを送信できませんでした。再接続してください。",
  ttsNotConfigured: "音声合成が設定されていません。Bailian API キーと接続先ドメインを確認してください。",
  ttsTimeout: "音声合成がタイムアウトしました。返信のテキストは確認できます。",
  ttsDataInvalid: "音声合成データに問題があります。返信のテキストは確認できます。",
  ttsIncomplete: "音声合成が完了しませんでした。返信のテキストは確認できます。",
  ttsEmpty: "音声サービスから音声が返されませんでした。返信のテキストは確認できます。",
  ttsUnavailable: "音声合成サービスに接続できません。返信のテキストは確認できます。",
  ttsDisconnected: "音声合成の接続が切れました。返信のテキストは確認できます。",
  chatStreamEmpty: "会話サービスから応答ストリームが返されませんでした。再試行してください。",
  chatDataInvalid: "会話データに問題があります。会話を開始し直してください。",
  replyInvalid: "返信の形式が正しくありません。再試行してください。",
  replyTimeout: "返信がタイムアウトしました。再試行してください。",
  chatUnavailable: "会話サービスに接続できません。ネットワークと Bailian の接続先ドメインを確認してください。",
  socketDisconnected: "ローカル接続が切断されました。会話を開始し直してください。",
  socketBusy: "ローカル音声接続が混雑しています。会話を開始し直してください。",
  socketTimeout: "ローカルサービスへの接続がタイムアウトしました。アプリが起動していることを確認してください。",
  connectionCancelled: "接続をキャンセルしました。",
  socketDataInvalid: "会話データを正しく受信できませんでした。会話を終了して、接続し直してください。",
  socketClosed: "ローカルサービスとの接続が切断されました。",
  sessionDisconnected: "接続が切断されました。会話履歴は保存されています。会話の開始ボタンを押して接続し直してください。",
  vadUnavailable: "音声の検出を利用できないため、テキスト入力に切り替えました。音声を開始し直すと再試行できます。",
  suggestionPlaybackFailed: "お手本の音声を再生できませんでした。もう一度お試しください。",
  suggestionPrepareFailed: "お手本の音声を準備できませんでした。もう一度お試しください。",
  microphoneFallback: "マイクを使用できないため、テキストでの会話に切り替えました。ブラウザーのサイト設定でマイクを許可すると、音声での会話を再開できます。",
  sessionStartTimeout: "会話の開始がタイムアウトしました。サービス設定を確認して、もう一度お試しください。",
  sessionStartRetry: "会話を開始できませんでした。もう一度お試しください。",
  sessionStartCancelled: "会話の開始をキャンセルしました。",
  textTooLong: "メッセージは 4,000 文字以内で入力してください。",
  replayUnavailable: "音声は現在の会話中のみ保存されます。再生できる音声がありません。",
  replyStopPending: "返信の停止を確認しています。少し待ってから、再生ボタンを押してください。",
  historyDuringSession: "現在の会話を終了してから、履歴を開いてください。",
  pageClosed: "ページを閉じました。",
  audioSessionEnded: "音声セッションは終了しました。会話を開始し直してください。",
  audioNotRunning: "ブラウザーの音声機能が起動していません。もう一度、会話の開始ボタンを押してください。",
  microphoneUnsupported: "このブラウザーではマイクを使用できません。この端末のブラウザーでページを開いてください。",
  microphoneDenied: "マイクの使用が許可されていません。テキストで会話を続けられます。",
  microphoneStartFailed: "マイクを起動できません。機器とブラウザーの権限を確認してください。テキストで会話を続けられます。",
  microphoneProcessingStopped: "マイクの音声処理が停止しました。音声での会話を開始し直してください。",
  microphoneDisconnected: "マイクが切断されました。テキストで会話を続けられます。",
  microphoneAudioFailed: "マイクの音声機能を起動できませんでした。テキストで会話を続けられます。",
  playbackDisabled: "音声の再生が有効になっていません。もう一度、会話の開始ボタンを押してください。返信はテキストで確認できます。",
  playbackQueueFull: "再生待ちの音声が長すぎるため、再生を停止しました。返信はテキストで確認できます。",
  playbackStorageFull: "音声が保存容量の上限を超えたため、再生を停止しました。返信はテキストで確認できます。",
  playbackFailed: "音声を再生できません。返信はテキストで確認できます。",
  replayNotSaved: "この音声は現在の会話に保存されていません。",
  replayExpired: "この音声は保存期間が終了しています。",
  replayFailed: "音声をもう一度再生できませんでした。再度お試しください。",
  playbackBlocked: "ブラウザーが音声の再生をブロックしました。もう一度、再生ボタンを押してください。",
  fieldCharacterName: "名前は必須です。{max} 文字以内で入力してください",
  fieldPersona: "性格は必須です。{max} 文字以内で入力してください",
  fieldLearningLanguage: "学習言語は必須です。{max} 文字以内で入力してください",
  fieldSupportLanguage: "解説言語は必須です。{max} 文字以内で入力してください",
  fieldVoice: "音声は必須です。{max} 文字以内で入力してください",
  fieldMemory: "メモは必須です。{max} 文字以内で入力してください",
} as const;

export type AppErrorCode = keyof typeof APP_ERROR_MESSAGES;
export type ErrorParams = Record<string, string | number>;
export interface ErrorDescriptor {
  message: string;
  errorCode?: string;
  errorParams?: ErrorParams;
}

const normalizeMessage = (message: string) => message.replace(/[。.!]+$/u, '').trim();
const legacyCodes = new Map<string, AppErrorCode>(Object.entries(APP_ERROR_MESSAGES)
  .map(([code, message]) => [normalizeMessage(message), code as AppErrorCode]));
const legacyAliases: Record<string, AppErrorCode> = {
  'ローカルサービスに接続できません。アプリが起動していることを確認してください。': 'serviceUnavailable',
  '接続が切断されました。会話を開始し直してください。': 'socketDisconnected',
  'まず会話を開始してください。': 'sessionRequired',
  '表示できる返信が生成されませんでした。再試行してください。': 'replyEmpty',
  'メッセージが見つかりません': 'messageNotFound',
};
for (const [message, code] of Object.entries(legacyAliases)) legacyCodes.set(normalizeMessage(message), code);
const fieldCodes: Record<string, AppErrorCode> = {
  名前: 'fieldCharacterName', 性格: 'fieldPersona', 学習言語: 'fieldLearningLanguage',
  解説言語: 'fieldSupportLanguage', 音声: 'fieldVoice', メモ: 'fieldMemory',
};

/** Describe an already-safe application error. Provider boundaries must sanitize upstream errors first. */
export function describeError(cause: unknown): ErrorDescriptor {
  const value = cause && typeof cause === 'object' ? cause as Record<string, unknown> : undefined;
  const message = typeof cause === 'string' ? cause
    : typeof value?.message === 'string' ? value.message
      : typeof value?.error === 'string' ? value.error : APP_ERROR_MESSAGES.serviceRequestFailed;
  const suppliedCode = typeof value?.errorCode === 'string' && value.errorCode.length <= 120
    ? value.errorCode : undefined;
  const rawParams = value?.errorParams;
  const errorParams = rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams)
    ? Object.fromEntries(Object.entries(rawParams).filter(([key, item]) => /^[a-zA-Z][a-zA-Z0-9]*$/.test(key)
      && (typeof item === 'string' || (typeof item === 'number' && Number.isFinite(item))))) : undefined;
  if (suppliedCode) return { message, errorCode: suppliedCode, ...(errorParams ? { errorParams } : {}) };
  const field = message.match(/^(名前|性格|学習言語|解説言語|音声|メモ)は必須です。([0-9]+) 文字以内で入力してください[。.]?$/u);
  if (field) return { message, errorCode: fieldCodes[field[1]], errorParams: { max: Number(field[2]) } };
  const errorCode = legacyCodes.get(normalizeMessage(message));
  return { message, ...(errorCode ? { errorCode } : {}), ...(errorParams ? { errorParams } : {}) };
}

/** Retains the legacy Japanese message while carrying language-independent presentation details. */
export class AppError extends Error {
  readonly errorCode?: string;
  readonly errorParams?: ErrorParams;

  constructor(message: string, details?: Partial<ErrorDescriptor>) {
    super(message);
    this.name = 'AppError';
    const descriptor = describeError({ ...details, message });
    this.errorCode = descriptor.errorCode;
    this.errorParams = descriptor.errorParams;
  }
}
