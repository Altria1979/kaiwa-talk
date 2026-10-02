import type { Locale } from '../locales';

const ja = {
  'common.language': '表示言語',
  'common.title': 'Violet Talk · AI と日本語会話練習',
  'common.description': 'AI アバターと音声で対話しながら、日本語の日常会話を練習できます。',
  'common.errorTitle': 'ページを表示できませんでした',
  'common.errorDescription': '少し待ってから、もう一度お試しください。',
  'common.retry': 'もう一度試す',
  'common.notFoundTitle': 'ページが見つかりません',
  'common.notFoundDescription': 'URL を確認するか、ホームに戻ってください。',
  'common.home': 'ホームに戻る',
  'common.operationFailed': '操作を完了できませんでした。しばらくしてからもう一度お試しください。',
};

export const commonMessages: Record<Locale, Record<keyof typeof ja, string>> = {
  ja,
  'zh-CN': {
    'common.language': '界面语言',
    'common.title': 'Violet Talk · AI 日语对练',
    'common.description': '与 AI 虚拟角色实时语音对话，练习日语口语和日常交流。',
    'common.errorTitle': '页面暂时无法显示',
    'common.errorDescription': '请稍候再试。',
    'common.retry': '重试',
    'common.notFoundTitle': '找不到页面',
    'common.notFoundDescription': '请检查网址，或返回首页。',
    'common.home': '返回首页',
    'common.operationFailed': '未能完成操作，请稍后重试。',
  },
  en: {
    'common.language': 'Interface language',
    'common.title': 'Violet Talk · AI Japanese Conversation Practice',
    'common.description': 'Practice everyday Japanese through real-time voice conversations with an AI avatar.',
    'common.errorTitle': 'This page could not be displayed',
    'common.errorDescription': 'Please wait a moment and try again.',
    'common.retry': 'Try again',
    'common.notFoundTitle': 'Page not found',
    'common.notFoundDescription': 'Check the URL or return to the home page.',
    'common.home': 'Back to home',
    'common.operationFailed': 'The action could not be completed. Please try again shortly.',
  },
};
