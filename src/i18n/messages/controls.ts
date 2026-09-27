import type { Locale } from '../locales';

const ja = {
  validChatEndpoint: '有効な会話エンドポイント', validAsrEndpoint: '有効な ASR inference エンドポイント', validTtsEndpoint: '有効な TTS realtime エンドポイント',
  navigation: 'メインナビゲーション', home: 'Kaiwa Talk のホーム', closeMenu: 'ナビゲーションメニューを閉じる', openMenu: 'ナビゲーションメニューを開く', menu: 'メニュー', practice: '会話の練習', history: '履歴', memories: '思い出', settings: '設定',
  bailianTitle: 'Alibaba Cloud Bailian API キー', getApiKey: 'API キーを取得', apiKey: 'API キー', apiKeyPlaceholder: 'API キーを貼り付け', hideApiKey: 'API キーを隠す', showApiKey: 'API キーを表示', hide: '隠す', show: '表示',
  browserPrivacy: 'ログインは不要です。履歴・メモ・設定はブラウザーごとに分かれます。サイトデータを消去すると、以前の履歴にはアクセスできなくなります。',
  storageHelp: 'API キーはこのブラウザーにのみ保存され、会話時にサーバーを経由して Bailian に送信されます。会話データベースには保存されません。ご自身の端末で設定してください。',
  endpoint: '接続先（任意）', apiHost: 'Bailian API ホスト', hostHelp: '空欄の場合は北京リージョンを使用します。別のリージョンやワークスペースを使う場合は、Bailian コンソールの API ホストを入力してください。ドメインのみを指定します（例：dashscope-intl.aliyuncs.com）。API キーと接続先のリージョンを合わせてください。',
  saving: '保存中…', updateApiKey: 'API キーを更新', saveApiKey: 'API キーを保存', deleteApiKey: '保存済みの API キーを削除', endBeforeKeyChange: 'API キーを変更するには、先に会話を終了してください。',
  loadingSettings: '設定を読み込み中…', browserKey: 'ブラウザーの API キーを使用中', enterApiKey: 'API キーを入力してください', refreshStatus: '状態を更新',
  configured: '設定が完了しました。API キーの権限と利用可能な残量は、会話を開始したときに確認されます。', saveToStart: 'API キーを保存すると会話を始められます。アプリの再起動は不要です。', connecting: 'サーバーに接続しています。しばらくお待ちください。',
  connectionDetails: '接続の詳細', region: 'リージョン', unset: '未設定', missingItems: '未設定の項目', chat: '会話', asr: '音声認識', tts: '音声合成',
  keyInvalid: 'API キーをすべて入力してください。空白や改行は含めないでください。', hostInvalid: '接続先には Bailian の公式ドメインを指定してください。半角英数字と記号のみ使用できます。', configIncomplete: '設定が不足しています。API キーと接続先を確認してください。',
  keySaved: 'API キーをこのブラウザーに保存しました。次の会話から適用されます。', keyDeleted: 'ブラウザーの API キーを削除しました。会話を始めるには、API キーを入力して保存してください。',
  readingDisplay: '読み方の表示', showKana: 'かなを表示', showRomaji: 'ローマ字を表示', kana: 'かな', romaji: 'ローマ字', reading: '読み方',
  aiReplies: 'AI の返信候補', readPractice: '読み上げの練習', chooseAgain: '候補を選び直す', close: '閉じる', open: '開く', repliesLoading: '返信候補を準備しています…', repliesEmpty: '返信候補はまだありません。そのまま会話を続けられます。',
  cancelSample: 'お手本の準備をキャンセル：{text}', stopSample: 'お手本を停止：{text}', listenSampleLabel: 'お手本を聞く：{text}', preparing: '準備中…', stop: '停止', listenSample: 'お手本を聞く', listening: '聞いています', pleaseRead: '読み上げてください', readAloud: '読み上げる', sendReplyLabel: 'この返信を送信：{text}', send: '送信',
  samplePreparingHint: 'お手本の音声を準備しています。もう一度押すとキャンセルできます。', samplePlayingHint: 'お手本を再生中です。聞き終わったら、まねして読んでみましょう。', nonJapaneseHint: '「お手本を聞く」で発音を確認できます。候補を選んで送信することもできます。',
  practiceListeningHint: '聞いています。この文を見ながら、自分のペースで読んでください。', practiceReadyHint: 'この文を見ながら読んでください。読み終えたら少し間を空けてください。', listeningHint: '聞いています。自分のペースで読んでください。', unavailableHint: '音声を検出できません。テキストで送信するか、音声入力を開始し直してください。', responseHint: '「お手本を聞く」で確認してから読んでみましょう。少し待つと{characterName}が返事をします。', unmuteHint: '「お手本を聞く」で確認し、「読み上げる」でマイクをオンにできます。', enableVoiceHint: '「お手本を聞く」で確認し、「読み上げる」で声に出して練習できます。',
  actions: '動き', emotions: '表情', interactions: 'ふれあい', wave: '手を振る', nod: 'うなずく', shake: '首を振る', bow: 'おじぎ', stretch: 'のびをする', auto: '自動', neutral: '自然', happy: 'うれしい', relaxed: 'リラックス', sad: 'かなしい', angry: 'おこる', surprised: 'びっくり', head: '頭をなでる', body: 'そっとつつく', hand: '手にタッチ',
  avatarUnavailable: 'このアバターでは利用できません', avatarNotReadyHint: 'アバターの準備ができると使えます。', actionsHint: '気になる動きを選んでみてください。', interactionsHint: 'アバターの頭・からだ・手にもタッチできます。', autoEmotionHint: '会話に合わせて表情が変わります。', fixedEmotionHint: '選んだ表情をキープ。「自動」で会話に合わせます。', playWithAvatar: 'アバターと遊ぶ', avatarControls: 'アバターの操作',
  avatarDescription: '{name}、日本語で話せる 3D パートナー', avatarLoading: '{name}を迎えています…', reload: '再読み込み',
  avatarErrorTooLarge: 'アバターファイルは 30 MB 以下にしてください。', avatarErrorInvalid: 'このファイルは有効な VRM 1.0 モデルではありません。', avatarErrorBinary: 'バイナリ形式の VRM 1.0 ファイルを選択してください。', avatarErrorIncomplete: 'モデルのデータが不足しています。', avatarErrorVersion: 'VRM 1.0 に対応しています。VRM 0.x のモデルは先に変換してください。', avatarErrorEmbedded: 'テクスチャを埋め込んだモデルを使用してください。外部ファイルは参照できません。', avatarErrorExternal: 'アバターモデルは外部リソースを読み込めません。', avatarErrorLoad: 'この VRM アバターを読み込めませんでした。', avatarErrorFile: 'この VRM アバターを読み込めませんでした。ファイルを確認して、もう一度お試しください。', avatarErrorWebGL: 'ブラウザーで 3D アバターを表示できません。ハードウェアアクセラレーションを有効にして、もう一度お試しください。', avatarErrorFetch: 'アバターファイルを読み込めませんでした。もう一度お試しいただくか、設定からモデルを読み込んでください。', avatarErrorUnknown: 'アバターを読み込めませんでした。もう一度お試しください。',
} as const;

export type ControlsMessageKey = keyof typeof ja;

const en: Record<ControlsMessageKey, string> = {
  validChatEndpoint: 'Valid conversation endpoint', validAsrEndpoint: 'Valid ASR inference endpoint', validTtsEndpoint: 'Valid TTS realtime endpoint',
  navigation: 'Main navigation', home: 'Kaiwa Talk home', closeMenu: 'Close navigation menu', openMenu: 'Open navigation menu', menu: 'Menu', practice: 'Conversation practice', history: 'History', memories: 'Memories', settings: 'Settings',
  bailianTitle: 'Alibaba Cloud Bailian API key', getApiKey: 'Get an API key', apiKey: 'API key', apiKeyPlaceholder: 'Paste your API key', hideApiKey: 'Hide API key', showApiKey: 'Show API key', hide: 'Hide', show: 'Show',
  browserPrivacy: 'No sign-in needed. History, memories and settings are separate for each browser. Clearing site data removes access to previous records.',
  storageHelp: 'Your API key is saved only in this browser and sent to Bailian through the server during conversations. It is not saved in the conversation database. Configure it on your own device.',
  endpoint: 'Endpoint (optional)', apiHost: 'Bailian API host', hostHelp: 'Leave blank to use the Beijing region. For another region or workspace, enter the API host shown in the Bailian console. Enter only the domain (for example, dashscope-intl.aliyuncs.com). Use the same region for your API key and endpoint.',
  saving: 'Saving…', updateApiKey: 'Update API key', saveApiKey: 'Save API key', deleteApiKey: 'Delete saved API key', endBeforeKeyChange: 'End the conversation before changing your API key.',
  loadingSettings: 'Loading settings…', browserKey: 'Using the browser API key', enterApiKey: 'Enter an API key', refreshStatus: 'Refresh status',
  configured: 'Configuration is complete. API key permissions and available quota will be checked when you start a conversation.', saveToStart: 'Save an API key to start a conversation. No app restart is needed.', connecting: 'Connecting to the server. Please wait.',
  connectionDetails: 'Connection details', region: 'Region', unset: 'Not set', missingItems: 'Missing settings', chat: 'Conversation', asr: 'Speech recognition', tts: 'Speech synthesis',
  keyInvalid: 'Enter the full API key without spaces or line breaks.', hostInvalid: 'Use an official Bailian domain for the endpoint. Only ASCII letters, numbers, and symbols are allowed.', configIncomplete: 'Configuration is incomplete. Check your API key and endpoint.',
  keySaved: 'API key saved in this browser. It will be used for your next conversation.', keyDeleted: 'The browser API key has been deleted. Enter and save an API key to start a conversation.',
  readingDisplay: 'Pronunciation display', showKana: 'Show kana', showRomaji: 'Show romaji', kana: 'Kana', romaji: 'Romaji', reading: 'Pronunciation',
  aiReplies: 'AI reply suggestions', readPractice: 'Reading practice', chooseAgain: 'Choose another reply', close: 'Close', open: 'Open', repliesLoading: 'Preparing reply suggestions…', repliesEmpty: 'No reply suggestions yet. You can keep the conversation going.',
  cancelSample: 'Cancel sample preparation: {text}', stopSample: 'Stop sample: {text}', listenSampleLabel: 'Listen to sample: {text}', preparing: 'Preparing…', stop: 'Stop', listenSample: 'Listen to sample', listening: 'Listening', pleaseRead: 'Read aloud now', readAloud: 'Read aloud', sendReplyLabel: 'Send this reply: {text}', send: 'Send',
  samplePreparingHint: 'Preparing the sample audio. Press again to cancel.', samplePlayingHint: 'Playing the sample. Try reading along after listening.', nonJapaneseHint: 'Use “Listen to sample” to check pronunciation. You can also choose a reply and send it.',
  practiceListeningHint: 'Listening. Read this sentence at your own pace.', practiceReadyHint: 'Read this sentence aloud, then pause briefly when you finish.', listeningHint: 'Listening. Read at your own pace.', unavailableHint: 'Audio could not be detected. Send text or restart voice input.', responseHint: 'Listen to the sample, then try reading aloud. {characterName} will reply after a short pause.', unmuteHint: 'Listen to the sample, then select “Read aloud” to turn on your microphone.', enableVoiceHint: 'Listen to the sample, then select “Read aloud” to practice speaking.',
  actions: 'Actions', emotions: 'Expressions', interactions: 'Interactions', wave: 'Wave', nod: 'Nod', shake: 'Shake head', bow: 'Bow', stretch: 'Stretch', auto: 'Auto', neutral: 'Neutral', happy: 'Happy', relaxed: 'Relaxed', sad: 'Sad', angry: 'Angry', surprised: 'Surprised', head: 'Pat head', body: 'Gentle poke', hand: 'Touch hand',
  avatarUnavailable: 'Unavailable for this avatar', avatarNotReadyHint: 'Available once the avatar is ready.', actionsHint: 'Choose an action to try.', interactionsHint: 'You can also touch the avatar’s head, body, or hands.', autoEmotionHint: 'Expressions change with the conversation.', fixedEmotionHint: 'Keeps the selected expression. Choose “Auto” to follow the conversation.', playWithAvatar: 'Play with the avatar', avatarControls: 'Avatar controls',
  avatarDescription: '{name}, a 3D partner who speaks Japanese', avatarLoading: 'Welcoming {name}…', reload: 'Reload',
  avatarErrorTooLarge: 'Choose an avatar file of 30 MB or less.', avatarErrorInvalid: 'This file is not a valid VRM 1.0 model.', avatarErrorBinary: 'Choose a binary VRM 1.0 file.', avatarErrorIncomplete: 'Model data is incomplete.', avatarErrorVersion: 'VRM 1.0 is supported. Convert VRM 0.x models before importing.', avatarErrorEmbedded: 'Use a model with embedded textures. External files cannot be referenced.', avatarErrorExternal: 'Avatar models cannot load external resources.', avatarErrorLoad: 'This VRM avatar could not be loaded.', avatarErrorFile: 'This VRM avatar could not be loaded. Check the file and try again.', avatarErrorWebGL: 'Your browser cannot display the 3D avatar. Enable hardware acceleration and try again.', avatarErrorFetch: 'The avatar file could not be loaded. Try again or import a model in settings.', avatarErrorUnknown: 'The avatar could not be loaded. Please try again.',
};

const zh: Record<ControlsMessageKey, string> = {
  validChatEndpoint: '有效的会话接入地址', validAsrEndpoint: '有效的 ASR inference 接入地址', validTtsEndpoint: '有效的 TTS realtime 接入地址',
  navigation: '主导航', home: 'Kaiwa Talk 首页', closeMenu: '关闭导航菜单', openMenu: '打开导航菜单', menu: '菜单', practice: '会话练习', history: '历史', memories: '记忆', settings: '设置',
  bailianTitle: '阿里云百炼 API Key', getApiKey: '获取 API Key', apiKey: 'API Key', apiKeyPlaceholder: '粘贴 API Key', hideApiKey: '隐藏 API Key', showApiKey: '显示 API Key', hide: '隐藏', show: '显示',
  browserPrivacy: '无需登录。历史、记忆和设置按浏览器独立保存；清除网站数据后，将无法再访问原来的记录。',
  storageHelp: 'API Key 仅保存在当前浏览器中，会话时通过服务端发送给百炼，不会保存在会话数据库中。请在自己的设备上设置。',
  endpoint: '连接地址（可选）', apiHost: '百炼 API 域名', hostHelp: '留空时使用北京地域。如使用其他地域或工作空间，请填写百炼控制台中的 API 域名。仅填写域名（例如 dashscope-intl.aliyuncs.com），并确保 API Key 与连接地址的地域一致。',
  saving: '保存中…', updateApiKey: '更新 API Key', saveApiKey: '保存 API Key', deleteApiKey: '删除已保存的 API Key', endBeforeKeyChange: '请先结束会话，再修改 API Key。',
  loadingSettings: '正在加载设置…', browserKey: '正在使用浏览器中的 API Key', enterApiKey: '请输入 API Key', refreshStatus: '刷新状态',
  configured: '配置已完成。开始会话时将检查 API Key 权限和可用额度。', saveToStart: '保存 API Key 后即可开始会话，无需重启应用。', connecting: '正在连接服务端，请稍候。',
  connectionDetails: '连接详情', region: '地域', unset: '未设置', missingItems: '缺少的配置', chat: '会话', asr: '语音识别', tts: '语音合成',
  keyInvalid: '请输入完整的 API Key，不要包含空格或换行。', hostInvalid: '连接地址请使用百炼官方域名，仅支持半角字母、数字和符号。', configIncomplete: '配置不完整，请检查 API Key 和连接地址。',
  keySaved: 'API Key 已保存在当前浏览器中，将从下一次会话开始使用。', keyDeleted: '已删除浏览器中的 API Key。请重新填写并保存 API Key 后开始对话。',
  readingDisplay: '读音显示', showKana: '显示假名', showRomaji: '显示罗马音', kana: '假名', romaji: '罗马音', reading: '读音',
  aiReplies: 'AI 回复建议', readPractice: '朗读练习', chooseAgain: '重新选择回复', close: '收起', open: '展开', repliesLoading: '正在准备回复建议…', repliesEmpty: '暂无回复建议，你可以继续会话。',
  cancelSample: '取消准备示范：{text}', stopSample: '停止示范：{text}', listenSampleLabel: '听示范：{text}', preparing: '准备中…', stop: '停止', listenSample: '听示范', listening: '正在聆听', pleaseRead: '请朗读', readAloud: '朗读', sendReplyLabel: '发送这条回复：{text}', send: '发送',
  samplePreparingHint: '正在准备示范语音，再次点击即可取消。', samplePlayingHint: '正在播放示范，听完后试着模仿朗读吧。', nonJapaneseHint: '点击“听示范”确认发音，也可以选择一条回复直接发送。',
  practiceListeningHint: '正在聆听，请看着这句话，按自己的节奏朗读。', practiceReadyHint: '请看着这句话朗读，读完后稍作停顿。', listeningHint: '正在聆听，请按自己的节奏朗读。', unavailableHint: '无法检测到语音，请发送文字或重新开启语音输入。', responseHint: '先听示范，再试着朗读。稍等片刻，{characterName}就会回复。', unmuteHint: '先听示范，再点击“朗读”开启麦克风。', enableVoiceHint: '先听示范，再点击“朗读”进行口语练习。',
  actions: '动作', emotions: '表情', interactions: '互动', wave: '挥手', nod: '点头', shake: '摇头', bow: '鞠躬', stretch: '伸懒腰', auto: '自动', neutral: '自然', happy: '开心', relaxed: '放松', sad: '难过', angry: '生气', surprised: '惊讶', head: '摸摸头', body: '轻轻戳一下', hand: '碰手',
  avatarUnavailable: '此虚拟形象不支持该操作', avatarNotReadyHint: '虚拟形象准备好后即可使用。', actionsHint: '选择一个动作试试吧。', interactionsHint: '也可以触碰虚拟形象的头部、身体和手。', autoEmotionHint: '表情会随会话变化。', fixedEmotionHint: '保持所选表情，选择“自动”可随会话变化。', playWithAvatar: '与虚拟形象互动', avatarControls: '虚拟形象操作',
  avatarDescription: '{name}，会说日语的 3D 伙伴', avatarLoading: '正在迎接{name}…', reload: '重新加载',
  avatarErrorTooLarge: '请选择不超过 30 MB 的虚拟形象文件。', avatarErrorInvalid: '此文件不是有效的 VRM 1.0 模型。', avatarErrorBinary: '请选择二进制格式的 VRM 1.0 文件。', avatarErrorIncomplete: '模型数据不完整。', avatarErrorVersion: '支持 VRM 1.0，导入 VRM 0.x 模型前请先转换。', avatarErrorEmbedded: '请使用内嵌贴图的模型，不能引用外部文件。', avatarErrorExternal: '虚拟形象模型不能加载外部资源。', avatarErrorLoad: '无法加载此 VRM 虚拟形象。', avatarErrorFile: '无法加载此 VRM 虚拟形象，请检查文件后重试。', avatarErrorWebGL: '浏览器无法显示 3D 虚拟形象，请开启硬件加速后重试。', avatarErrorFetch: '无法加载虚拟形象文件，请重试或在设置中导入模型。', avatarErrorUnknown: '无法加载虚拟形象，请重试。',
};

function namespace(messages: Record<ControlsMessageKey, string>) {
  return Object.fromEntries(Object.entries(messages).map(([key, value]) => [`controls.${key}`, value])) as Record<`controls.${ControlsMessageKey}`, string>;
}

export const controlsMessages: Record<Locale, Record<`controls.${ControlsMessageKey}`, string>> = {
  ja: namespace(ja), en: namespace(en), 'zh-CN': namespace(zh),
};
