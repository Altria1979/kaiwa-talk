'use client';

import { AppError, describeError, type ErrorDescriptor } from '../../shared/app-errors';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, type ChatMessage, type ClientEvent, type ConversationState, type MessageReadingAid, type ServerEvent, type SessionRecord } from '../../shared/protocol';
import { isAvatarEmotion, type AvatarEmotion } from '../../shared/avatar-emotion';
import { api, ensureBrowserSession, SOCKET_URL } from '../lib/api';
import { readBrowserCredentials } from '../lib/bailian-credentials';
import { BrowserAudio } from '../lib/browser-audio';
import type { VadStatus } from '../lib/browser-vad';
import { SpeechAdmission } from '../lib/speech-admission';
import type { PlaybackCaption } from '../lib/playback-captions';

type StartOptions = { voice: boolean; sessionId?: string };
type PendingStart = { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
export type ReplySuggestionsState = Extract<ServerEvent, { type: 'reply.suggestions' }>;
export type SuggestionSpeech = { messageId: string; index: number; status: 'loading' | 'playing' };
type SuggestionSpeechRequest = SuggestionSpeech & { controller: AbortController; audioTurnId: string };

export function useConversation({ vadSilenceMs = DEFAULT_SETTINGS.vadSilenceMs }: { vadSilenceMs?: number } = {}) {
  const [state, setState] = useState<ConversationState>('idle');
  const [avatarEmotion, setAvatarEmotion] = useState<AvatarEmotion>('neutral');
  const [connected, setConnected] = useState(false);
  const [active, setActive] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [muted, setMuted] = useState(false);
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [replySuggestions, setReplySuggestions] = useState<ReplySuggestionsState | null>(null);
  const [suggestionSpeech, setSuggestionSpeech] = useState<SuggestionSpeech | null>(null);
  const [transcript, setTranscript] = useState('');
  const [pendingTranscript, setPendingTranscript] = useState('');
  const [errorDetails, setErrorDetails] = useState<ErrorDescriptor | null>(null);
  const error = errorDetails?.message ?? null;
  const [audioBusy, setAudioBusy] = useState(false);
  const [playbackCaption, setPlaybackCaption] = useState<PlaybackCaption | null>(null);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [vadStatus, setVadStatus] = useState<VadStatus>('idle');
  const [, setAudioRevision] = useState(0);
  const audioLevelRef = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<BrowserAudio | null>(null);
  const sessionRef = useRef<SessionRecord | null>(null);
  const activeRef = useRef(false);
  const voiceRef = useRef(false);
  const mutedRef = useRef(false);
  const turnRef = useRef<string | null>(null);
  const replyMessageRef = useRef<string | null>(null);
  const cancelledRef = useRef(new Set<string>());
  const startRef = useRef<Promise<void> | null>(null);
  const pendingRef = useRef<PendingStart | null>(null);
  const lifecycleRef = useRef(0);
  const mountedRef = useRef(true);
  const endingRef = useRef(false);
  const credentialsRef = useRef<ReturnType<typeof readBrowserCredentials>>(undefined);
  const reconnectRef = useRef<(() => Promise<void>) | null>(null);
  const reconnectTaskRef = useRef<Promise<void> | null>(null);
  const reconnectWaitRef = useRef<{ timer: ReturnType<typeof setTimeout>; resolve: () => void } | null>(null);
  const captureFailedRef = useRef(false);
  const replayRequestRef = useRef(0);
  const audioGenerationRef = useRef(0);
  const speechEpochRef = useRef(0);
  const speechAdmissionRef = useRef(new SpeechAdmission());
  const speechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const asrStreamRef = useRef<string | null>(null);
  const audioBusyRef = useRef(false);
  const replyGeneratingRef = useRef(false);
  const vadStatusRef = useRef<VadStatus>('idle');
  const suggestionSpeechRef = useRef<SuggestionSpeechRequest | null>(null);
  const replySuggestionsRef = useRef<ReplySuggestionsState | null>(null);

  const resetAvatarEmotion = useCallback(() => {
    replyMessageRef.current = null;
    setAvatarEmotion('neutral');
  }, []);

  const send = useCallback((event: ClientEvent) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) throw new AppError('ローカル接続が切断されました。会話を開始し直してください。');
    if (socket.bufferedAmount > 512 * 1024) {
      socket.close(1013, 'ローカル接続が混雑しています。');
      throw new AppError('ローカル音声接続が混雑しています。会話を開始し直してください。');
    }
    socket.send(JSON.stringify(event));
  }, []);

  const resetSpeechInput = useCallback((notify = true) => {
    ++speechEpochRef.current;
    if (speechTimerRef.current) clearTimeout(speechTimerRef.current);
    speechTimerRef.current = null;
    const streamId = asrStreamRef.current;
    const beforeMs = audioRef.current?.getRecognitionTime() ?? 0;
    speechAdmissionRef.current.reset(streamId, beforeMs);
    if (notify && streamId && activeRef.current && voiceRef.current && !endingRef.current && socketRef.current?.readyState === WebSocket.OPEN) {
      try { send({ type: 'speech.reset', streamId, beforeMs }); } catch { /* Socket lifecycle handles errors. */ }
    }
    if (mountedRef.current) { setUserSpeaking(false); setTranscript(''); setPendingTranscript(''); }
  }, [send]);

  const stopSuggestionSpeech = useCallback((completed = false) => {
    const request = suggestionSpeechRef.current;
    if (!request) return;
    // Clear first: cancelTurn can synchronously report onBusy(false).
    suggestionSpeechRef.current = null;
    request.controller.abort();
    if (!completed) audioRef.current?.cancelTurn(request.audioTurnId);
    audioRef.current?.setMuted(mutedRef.current);
    resetSpeechInput();
    if (mountedRef.current) {
      setSuggestionSpeech(null);
      if (!completed) setPlaybackCaption(null);
    }
  }, [resetSpeechInput]);

  const releaseAudio = useCallback(() => {
    stopSuggestionSpeech();
    replySuggestionsRef.current = null;
    ++replayRequestRef.current;
    ++audioGenerationRef.current;
    resetSpeechInput();
    vadStatusRef.current = 'idle';
    const audio = audioRef.current;
    audioRef.current = null;
    asrStreamRef.current = null;
    speechAdmissionRef.current.reset(null);
    audioBusyRef.current = false;
    replyGeneratingRef.current = false;
    audio?.stopMicrophone();
    if (audio) void audio.dispose().catch(() => {});
    audioLevelRef.current = 0;
    if (mountedRef.current) {
      setStreamingMessageId(null);
      setTranscript('');
      setPendingTranscript('');
      setAudioBusy(false);
      setPlaybackCaption(null);
      setVadStatus('idle');
      setAudioRevision(value => value + 1);
    }
  }, [resetSpeechInput, stopSuggestionSpeech]);

  const rememberCancellation = useCallback((id: string) => {
    cancelledRef.current.add(id);
    if (cancelledRef.current.size > 128) cancelledRef.current.delete(cancelledRef.current.values().next().value!);
  }, []);

  const interruptTurn = useCallback((targetTurnId: string | null, notifyServer: boolean, replayRequest = replayRequestRef.current) => {
    if (targetTurnId) {
      const alreadyCancelled = cancelledRef.current.has(targetTurnId);
      rememberCancellation(targetTurnId);
      // A delayed local confirmation or cloud event must never stop a newer reply.
      if (turnRef.current !== targetTurnId || alreadyCancelled) return;
      turnRef.current = null;
    } else if (turnRef.current !== null || replayRequest !== replayRequestRef.current) {
      // With no reply at speech onset, only the replay present at that onset may stop.
      return;
    }
    resetAvatarEmotion();
    setStreamingMessageId(null);
    ++replayRequestRef.current;
    audioRef.current?.cancelTurn();
    replyGeneratingRef.current = false;
    setPlaybackCaption(null);
    audioLevelRef.current = 0;
    setAudioBusy(false);
    setAudioRevision(value => value + 1);
    setReplySuggestions(current => current?.status === 'ready' ? current : null);
    setState(activeRef.current ? 'listening' : 'idle');
    if (notifyServer && targetTurnId && socketRef.current?.readyState === WebSocket.OPEN) {
      try { send({ type: 'cancel', turnId: targetTurnId }); } catch { /* Connection lifecycle handles errors. */ }
    }
  }, [rememberCancellation, resetAvatarEmotion, send]);

  const evaluateSpeech = useCallback(function evaluateSpeechEvidence() {
    if (speechTimerRef.current) clearTimeout(speechTimerRef.current);
    speechTimerRef.current = null;
    if (!activeRef.current || !voiceRef.current || mutedRef.current || endingRef.current || suggestionSpeechRef.current || vadStatusRef.current !== 'ready') return;
    const now = performance.now();
    for (const { transcript: accepted, context, accept } of speechAdmissionRef.current.evaluate(now)) {
      if (context.epoch !== speechEpochRef.current) continue;
      setTranscript(accepted.final ? '' : accepted.text);
      setPendingTranscript(accepted.text.trim());
      setUserSpeaking(!accepted.final);
      if (accept) {
        if (context.interrupting) interruptTurn(context.turnId, true, context.replayRequest);
        try { send({ type: 'speech.accept', streamId: accepted.streamId, segmentId: accepted.segmentId }); } catch { /* Socket lifecycle handles errors. */ }
      }
    }
    const deadline = speechAdmissionRef.current.nextDeadline(now);
    if (deadline !== null) speechTimerRef.current = setTimeout(evaluateSpeechEvidence, Math.max(1, deadline - now));
  }, [interruptTurn, send]);

  const onEvent = useCallback((event: ServerEvent) => {
    if (!mountedRef.current) return;
    const upsert = (message: ChatMessage) => setMessages(current => {
      const index = current.findIndex(item => item.id === message.id);
      if (index < 0) return [...current, message];
      return current.map(item => {
        if (item.id !== message.id) return item;
        // Speech acknowledgements may arrive after the client loaded reading aids.
        if (item.content === message.content && item.readingAid && !message.readingAid) return { ...message, readingAid: item.readingAid };
        return message;
      });
    });
    switch (event.type) {
      case 'session.started': {
        if (endingRef.current) { send({ type: 'end' }); return; }
        if (!activeRef.current || sessionRef.current?.id !== event.session.id) {
          resetAvatarEmotion();
          setStreamingMessageId(null);
        }
        if (sessionRef.current?.id !== event.session.id) { setMessages([]); setReplySuggestions(null); }
        if (event.messages) setMessages(event.messages);
        setPlaybackCaption(null);
        setTranscript(''); setPendingTranscript('');
        sessionRef.current = event.session;
        setSession(event.session);
        activeRef.current = true;
        voiceRef.current = event.voice;
        setActive(true); setVoiceEnabled(event.voice);
        if (asrStreamRef.current !== (event.asrStreamId ?? null)) {
          asrStreamRef.current = event.asrStreamId ?? null;
          audioRef.current?.setRecognitionStream(asrStreamRef.current);
          resetSpeechInput(false);
        }
        if (event.voice) audioRef.current?.setVadEnabled(true);
        if (!event.voice) { audioRef.current?.stopMicrophone(); resetSpeechInput(); vadStatusRef.current = 'idle'; setVadStatus('idle'); }
        setState('listening');
        if (pendingRef.current) {
          clearTimeout(pendingRef.current.timer);
          pendingRef.current.resolve();
          pendingRef.current = null;
        }
        break;
      }
      case 'session.ended':
        // A recap can arrive after a different history entry has been selected.
        if (sessionRef.current?.id !== event.session.id) break;
        sessionRef.current = event.session; setSession(event.session);
        activeRef.current = false; voiceRef.current = false;
        resetAvatarEmotion();
        setActive(false); setVoiceEnabled(false); setMuted(false); mutedRef.current = false;
        endingRef.current = false;
        setTranscript(''); setState('idle');
        setReplySuggestions(null);
        replySuggestionsRef.current = null;
        releaseAudio();
        break;
      case 'state':
        if (!suggestionSpeechRef.current && (!endingRef.current || event.state === 'idle')) setState(event.state);
        break;
      case 'transcript': {
        if (!activeRef.current || !voiceRef.current || mutedRef.current || endingRef.current || suggestionSpeechRef.current || vadStatusRef.current !== 'ready') break;
        speechAdmissionRef.current.transcript(event, performance.now(), audioRef.current?.getRecognitionTime() ?? 0);
        evaluateSpeech();
        break;
      }
      case 'speech.started':
        // Cloud onset is only metadata. Frame-aligned text plus local evidence
        // must pass admission before captions, cancellation or submission.
        break;
      case 'message':
        if (event.message.sessionId === sessionRef.current?.id) {
          if (event.message.role === 'assistant' && cancelledRef.current.has(event.message.turnId) && !event.message.interrupted) break;
          upsert(event.message);
          if (event.message.role === 'user') {
            resetAvatarEmotion();
            stopSuggestionSpeech();
            replySuggestionsRef.current = null;
            setReplySuggestions(null);
            setTranscript(''); setPendingTranscript('');
          }
        }
        break;
      case 'reply.start':
        if (endingRef.current || !activeRef.current || cancelledRef.current.has(event.turnId) || event.message.sessionId !== sessionRef.current?.id || event.message.turnId !== event.turnId || event.message.role !== 'assistant') break;
        resetAvatarEmotion();
        replyMessageRef.current = event.message.id;
        setStreamingMessageId(event.message.id);
        stopSuggestionSpeech();
        replySuggestionsRef.current = null;
        resetSpeechInput();
        ++replayRequestRef.current;
        setReplySuggestions(null);
        turnRef.current = event.turnId;
        replyGeneratingRef.current = true;
        setPlaybackCaption(null);
        audioRef.current?.beginTurn(event.turnId);
        upsert(event.message);
        break;
      case 'avatar.emotion':
        if (!activeRef.current || endingRef.current || event.turnId !== turnRef.current || event.messageId !== replyMessageRef.current || cancelledRef.current.has(event.turnId) || !isAvatarEmotion(event.emotion)) break;
        setAvatarEmotion(event.emotion);
        break;
      case 'reply.delta':
        if (event.turnId !== turnRef.current || cancelledRef.current.has(event.turnId) || endingRef.current) break;
        setMessages(current => current.map(item => item.turnId === event.turnId && item.role === 'assistant' ? { ...item, content: item.content + event.delta } : item));
        break;
      case 'reply.done':
        if (!cancelledRef.current.has(event.turnId) && event.message.sessionId === sessionRef.current?.id) {
          upsert(event.message);
          // Text is ready for reading aids before TTS generation and playback finish.
          if (event.turnId === turnRef.current && event.message.turnId === event.turnId && event.message.role === 'assistant') {
            setStreamingMessageId(current => current === event.message.id ? null : current);
          }
        }
        break;
      case 'reply.suggestions':
        if (!activeRef.current || endingRef.current || event.turnId !== turnRef.current || cancelledRef.current.has(event.turnId)) break;
        replySuggestionsRef.current = event;
        setReplySuggestions(event);
        if (event.status === 'ready') setMessages(current => current.map(item =>
          item.id === event.messageId && item.turnId === event.turnId
            ? { ...item, replySuggestions: event.suggestions, replySuggestionsLanguage: event.meaningLanguage ?? 'ja' } : item));
        break;
      case 'audio.sentence':
        if (activeRef.current && !suggestionSpeechRef.current && event.turnId === turnRef.current && !cancelledRef.current.has(event.turnId) && !endingRef.current) audioRef.current?.registerSentence(event.turnId, event.sentenceId, event.text);
        break;
      case 'audio':
        if (activeRef.current && !suggestionSpeechRef.current && event.turnId === turnRef.current && !cancelledRef.current.has(event.turnId) && !endingRef.current) audioRef.current?.pushAudio(event.turnId, event.sentenceId, event.audio);
        break;
      case 'audio.end':
        if (activeRef.current && !suggestionSpeechRef.current && event.turnId === turnRef.current && !cancelledRef.current.has(event.turnId) && !endingRef.current) {
          audioRef.current?.finishSentence(event.turnId, event.sentenceId, event.text);
          setAudioRevision(value => value + 1);
        }
        break;
      case 'turn.done':
        if (event.turnId === turnRef.current) replyGeneratingRef.current = false;
        setAudioRevision(value => value + 1);
        break;
      case 'turn.cancelled':
        if (cancelledRef.current.has(event.turnId) && turnRef.current !== event.turnId) break;
        rememberCancellation(event.turnId);
        audioRef.current?.cancelTurn(event.turnId);
        setPlaybackCaption(current => current?.turnId === event.turnId ? null : current);
        if (turnRef.current === event.turnId) { turnRef.current = null; replyGeneratingRef.current = false; resetAvatarEmotion(); setStreamingMessageId(null); }
        setReplySuggestions(current => current?.turnId === event.turnId && current.status !== 'ready' ? null : current);
        setAudioRevision(value => value + 1);
        break;
      case 'error':
        stopSuggestionSpeech();
        resetSpeechInput();
        ++replayRequestRef.current;
        setPlaybackCaption(null);
        setErrorDetails(describeError(event));
        if (event.source === 'asr' || event.source === 'tts' || event.source === 'chat') audioRef.current?.cancelTurn();
        if (event.source === 'asr') {
          setTranscript(''); setPendingTranscript('');
          audioRef.current?.stopMicrophone();
          resetSpeechInput(); vadStatusRef.current = 'idle'; setVadStatus('idle');
          voiceRef.current = false; setVoiceEnabled(false);
        }
        if (event.source === 'config' || (event.source === 'session' && pendingRef.current)) {
          if (pendingRef.current) {
            clearTimeout(pendingRef.current.timer);
            pendingRef.current.reject(new AppError(event.message, event));
            pendingRef.current = null;
          }
          setState(activeRef.current ? 'listening' : 'error');
        }
        break;
    }
  }, [evaluateSpeech, releaseAudio, rememberCancellation, resetAvatarEmotion, resetSpeechInput, send, stopSuggestionSpeech]);

  const connect = useCallback(async () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) return;
    const generation = lifecycleRef.current;
    await ensureBrowserSession();
    if (!mountedRef.current || generation !== lifecycleRef.current) throw new AppError('接続をキャンセルしました。');
    if (socketRef.current?.readyState === WebSocket.OPEN) return;
    const socket = new WebSocket(SOCKET_URL);
    socketRef.current = socket;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new AppError('ローカルサービスへの接続がタイムアウトしました。アプリが起動していることを確認してください。')); }, 10_000);
      socket.onopen = () => {
        clearTimeout(timer);
        if (socketRef.current !== socket || !mountedRef.current) { socket.close(); reject(new AppError('接続をキャンセルしました。')); return; }
        setConnected(true); resolve();
      };
      socket.onmessage = message => {
        if (socketRef.current !== socket || !mountedRef.current) return;
        try { onEvent(JSON.parse(String(message.data)) as ServerEvent); }
        catch { setErrorDetails(describeError('会話データを正しく受信できませんでした。会話を終了して、接続し直してください。')); }
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new AppError('ローカルサービスに接続できません。アプリが起動していることを確認してください。'));
      };
      socket.onclose = () => {
        clearTimeout(timer);
        reject(new AppError('ローカルサービスとの接続が切断されました。'));
        if (socketRef.current !== socket || !mountedRef.current) return;
        socketRef.current = null;
        if (pendingRef.current) {
          clearTimeout(pendingRef.current.timer);
          pendingRef.current.reject(new AppError('接続が切断されました。会話を開始し直してください。'));
          pendingRef.current = null;
        }
        const shouldResume = activeRef.current && !endingRef.current && !!sessionRef.current;
        setConnected(false);
        if (turnRef.current) rememberCancellation(turnRef.current);
        turnRef.current = null;
        replyGeneratingRef.current = false;
        setStreamingMessageId(null);
        setTranscript(''); setReplySuggestions(null);
        replySuggestionsRef.current = null;
        resetAvatarEmotion();
        resetSpeechInput(false);
        stopSuggestionSpeech();
        audioRef.current?.cancelTurn();
        audioRef.current?.stopMicrophone();
        audioRef.current?.setRecognitionStream(null);
        asrStreamRef.current = null;
        vadStatusRef.current = 'idle'; setVadStatus('idle');
        setPlaybackCaption(null);
        if (shouldResume) {
          // Preserve the user's mute/voice choice and the browser AudioContext.
          // Resuming only restores history; an interrupted utterance is never resent.
          setState('connecting');
          queueMicrotask(() => { void reconnectRef.current?.().catch(() => {}); });
        } else {
          ++lifecycleRef.current;
          activeRef.current = false; voiceRef.current = false;
          mutedRef.current = false; setMuted(false);
          setActive(false); setVoiceEnabled(false);
          endingRef.current = false;
          setState('idle'); releaseAudio();
        }
      };
    });
  }, [onEvent, releaseAudio, rememberCancellation, resetAvatarEmotion, resetSpeechInput, stopSuggestionSpeech]);

  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      const generation = ++audioGenerationRef.current;
      const isCurrent = (): boolean => mountedRef.current && generation === audioGenerationRef.current && audioRef.current === audio;
      const canDetectSpeech = () => isCurrent() && activeRef.current && voiceRef.current && !mutedRef.current && !endingRef.current && !suggestionSpeechRef.current;
      const audio: BrowserAudio = new BrowserAudio({
      levelRef: audioLevelRef,
      vadRedemptionMs: vadSilenceMs,
      getSpeechContext: () => ({
        epoch: speechEpochRef.current,
        interrupting: replyGeneratingRef.current || audioBusyRef.current,
        turnId: turnRef.current,
        replayRequest: replayRequestRef.current,
      }),
      onPcm: (audio, streamId) => {
        if (isCurrent() && activeRef.current && voiceRef.current && !endingRef.current && streamId === asrStreamRef.current) {
          try { send({ type: 'audio', audio, streamId }); } catch { /* onclose releases resources */ }
        }
      },
      onVadFrame: frame => {
        if (!canDetectSpeech() || frame.context.epoch !== speechEpochRef.current || vadStatusRef.current !== 'ready') return;
        speechAdmissionRef.current.frame(frame);
        evaluateSpeech();
      },
      onPlayed: (turnId, sentenceId) => {
        if (isCurrent() && activeRef.current && turnId === turnRef.current && !cancelledRef.current.has(turnId)) {
          try { send({ type: 'played', turnId, sentenceId }); } catch { /* connection state handles error */ }
        }
      },
      onCaption: caption => {
        if (isCurrent() && activeRef.current && !endingRef.current) setPlaybackCaption(caption);
      },
      onBusy: busy => {
        if (!isCurrent()) return;
        audioBusyRef.current = busy;
        setAudioBusy(busy);
        const request = suggestionSpeechRef.current;
        if (busy && request) {
          request.status = 'playing';
          setSuggestionSpeech({ messageId: request.messageId, index: request.index, status: 'playing' });
        } else if (!busy && request?.status === 'playing') {
          // Playback errors can follow the idle callback in the same stack.
          // Keep the request until then so an error leaves the options available to retry.
          queueMicrotask(() => { if (suggestionSpeechRef.current === request) stopSuggestionSpeech(true); });
        }
      },
      onVadStatus: status => {
        if (!isCurrent() || endingRef.current) return;
        vadStatusRef.current = status;
        setVadStatus(status);
        if (status !== 'ready') resetSpeechInput();
        if (status === 'unavailable') {
          audio.stopMicrophone();
          voiceRef.current = false;
          setVoiceEnabled(false);
          try { send({ type: 'voice.stop' }); } catch { /* Socket lifecycle handles errors. */ }
          setErrorDetails(describeError('音声の検出を利用できないため、テキスト入力に切り替えました。音声を開始し直すと再試行できます。'));
        }
      },
      onError: (message, source, details) => {
        if (!isCurrent()) return;
        setPlaybackCaption(null);
        setErrorDetails(details ?? describeError(message));
        if (suggestionSpeechRef.current && source !== 'capture') {
          stopSuggestionSpeech();
          return;
        }
        stopSuggestionSpeech();
        setReplySuggestions(null);
        if (source === 'capture') {
          setTranscript(''); setPendingTranscript('');
          captureFailedRef.current = true;
          resetSpeechInput(); vadStatusRef.current = 'idle'; setVadStatus('idle');
          voiceRef.current = false;
          setVoiceEnabled(false);
          try { send({ type: 'voice.stop' }); } catch { /* already disconnected */ }
        }
        interruptTurn(turnRef.current, true);
      },
      });
      audioRef.current = audio;
    }
    audioRef.current.setMuted(mutedRef.current || !!suggestionSpeechRef.current);
    return audioRef.current;
  }, [evaluateSpeech, interruptTurn, resetSpeechInput, send, stopSuggestionSpeech, vadSilenceMs]);

  const reconnect = useCallback((): Promise<void> => {
    if (reconnectTaskRef.current) return reconnectTaskRef.current;
    if (!activeRef.current || endingRef.current || !sessionRef.current) return Promise.resolve();
    const generation = ++lifecycleRef.current;
    const sessionId = sessionRef.current.id;
    const current = () => mountedRef.current && generation === lifecycleRef.current && activeRef.current && !endingRef.current && sessionRef.current?.id === sessionId;
    const task = (async () => {
      const deadline = Date.now() + 90_000;
      let lastError: unknown;
      for (let attempt = 0; attempt < 12 && Date.now() < deadline && current(); attempt++) {
        if (attempt) await new Promise<void>(resolve => {
          const timer = setTimeout(() => { reconnectWaitRef.current = null; resolve(); }, Math.min(500 * 2 ** (attempt - 1), 5000));
          reconnectWaitRef.current = { timer, resolve };
        });
        if (!current()) return;
        try {
          setState('connecting');
          await connect();
          if (!current()) return;
          let voice = voiceRef.current;
          if (voice) {
            const audio = getAudio();
            try { await audio.prepare(); await audio.startMicrophone(vadSilenceMs); }
            catch { voice = false; audio.stopMicrophone(); setErrorDetails(describeError('マイクを使用できないため、テキストでの会話に切り替えました。ブラウザーのサイト設定でマイクを許可すると、音声での会話を再開できます。')); }
          }
          if (!current()) { audioRef.current?.stopMicrophone(); return; }
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              pendingRef.current = null;
              reject(new AppError('会話の開始がタイムアウトしました。サービス設定を確認して、もう一度お試しください。'));
            }, Math.min(20_000, Math.max(1, deadline - Date.now())));
            pendingRef.current = { resolve, reject, timer };
            try { send({ type: 'start', sessionId, resume: true, voice, credentials: credentialsRef.current }); }
            catch (cause) { clearTimeout(timer); pendingRef.current = null; reject(cause); }
          });
          if (current()) setErrorDetails(null);
          return;
        } catch (cause) {
          if (!current()) return;
          lastError = cause;
          audioRef.current?.stopMicrophone();
          const socket = socketRef.current;
          socketRef.current = null;
          socket?.close(1000, 'Retry session resume');
          setConnected(false);
          // A missing/ended conversation or invalid credentials cannot recover by waiting.
          if (cause instanceof AppError && ['browserSessionRequired', 'sessionNotFound', 'credentialsRequired', 'configInvalid', 'apiKeyInvalid', 'apiKeyRequired'].includes(cause.errorCode ?? '')) break;
        }
      }
      if (!current()) return;
      activeRef.current = false; voiceRef.current = false;
      setActive(false); setVoiceEnabled(false); setState('error');
      setErrorDetails(describeError(lastError instanceof AppError ? lastError : '接続が切断されました。会話履歴は保存されています。会話の開始ボタンを押して接続し直してください。'));
      releaseAudio();
    })();
    reconnectTaskRef.current = task;
    void task.finally(() => { if (reconnectTaskRef.current === task) reconnectTaskRef.current = null; }).catch(() => {});
    return task;
  }, [connect, getAudio, releaseAudio, send, vadSilenceMs]);

  useEffect(() => { reconnectRef.current = reconnect; }, [reconnect]);

  const listenSuggestion = useCallback(async (messageId: string, index: number) => {
    const current = suggestionSpeechRef.current;
    if (current?.messageId === messageId && current.index === index) {
      stopSuggestionSpeech();
      return;
    }
    const suggestions = replySuggestionsRef.current;
    const suggestion = suggestions?.messageId === messageId && suggestions.status === 'ready' && Number.isInteger(index)
      ? suggestions.suggestions[index] : undefined;
    if (!suggestion || !activeRef.current || endingRef.current) return;
    stopSuggestionSpeech();
    const audio = getAudio();
    const request: SuggestionSpeechRequest = {
      messageId, index, status: 'loading', controller: new AbortController(), audioTurnId: `suggestion:${messageId}:${index}`,
    };
    suggestionSpeechRef.current = request;
    setSuggestionSpeech({ messageId, index, status: 'loading' });
    setState('listening');
    setErrorDetails(null);
    ++replayRequestRef.current;
    resetSpeechInput();
    audio.cancelTurn();
    setPlaybackCaption(null);
    // Keep the user's mute preference separate from this temporary playback mute.
    audio.setMuted(true);
    const isCurrent = () => mountedRef.current && suggestionSpeechRef.current === request && activeRef.current && !endingRef.current;
    try {
      // Suggestions can arrive before the original reply finishes synthesizing.
      // Stop that upstream turn as well as its local audio, keeping the ready options.
      if (turnRef.current) {
        const previousTurn = turnRef.current;
        rememberCancellation(previousTurn);
        turnRef.current = null;
        resetAvatarEmotion();
        setStreamingMessageId(null);
        replyGeneratingRef.current = false;
        send({ type: 'cancel', turnId: previousTurn });
      }
      // Prepare synchronously from the click; listening never asks for microphone access.
      await audio.prepare();
      if (!isCurrent()) return;
      if (audio.canReplay(request.audioTurnId)) {
        await audio.replay(request.audioTurnId);
      } else {
        const result = await api.suggestionAudio(messageId, index, request.controller.signal);
        if (!isCurrent()) return;
        if (result.sampleRate !== 24000 || !result.audio) throw new AppError('お手本の音声を再生できませんでした。もう一度お試しください。');
        audio.beginTurn(request.audioTurnId);
        audio.registerSentence(request.audioTurnId, 'example', suggestion.text);
        audio.pushAudio(request.audioTurnId, 'example', result.audio);
        audio.finishSentence(request.audioTurnId, 'example', suggestion.text);
      }
    } catch (cause) {
      if (!isCurrent()) return;
      stopSuggestionSpeech();
      setErrorDetails(describeError(cause instanceof Error ? cause : 'お手本の音声を準備できませんでした。もう一度お試しください。'));
    }
  }, [getAudio, rememberCancellation, resetAvatarEmotion, resetSpeechInput, send, stopSuggestionSpeech]);

  const start = useCallback((options: StartOptions): Promise<void> => {
    stopSuggestionSpeech();
    if (startRef.current) return startRef.current;
    if (activeRef.current && socketRef.current?.readyState !== WebSocket.OPEN) return reconnect();
    if (activeRef.current && (!options.voice || voiceRef.current)) return Promise.resolve();
    const generation = ++lifecycleRef.current;
    if (!activeRef.current) { resetAvatarEmotion(); setStreamingMessageId(null); }
    endingRef.current = false;
    resetSpeechInput();
    setTranscript(''); setPendingTranscript('');
    setPlaybackCaption(null);
    captureFailedRef.current = false;
    setErrorDetails(null); setState('connecting');
    const task = (async () => {
      let useVoice = options.voice;
      try {
        const credentials = activeRef.current ? credentialsRef.current : readBrowserCredentials();
        credentialsRef.current = credentials;
        if (useVoice) {
          // Called before the first await so browser user activation is retained.
          const audio = getAudio();
          try { await audio.prepare(); await audio.startMicrophone(vadSilenceMs); }
          catch { useVoice = false; audio.stopMicrophone(); setErrorDetails(describeError('マイクを使用できないため、テキストでの会話に切り替えました。ブラウザーのサイト設定でマイクを許可すると、音声での会話を再開できます。')); }
        }
        if (generation !== lifecycleRef.current || !mountedRef.current) { releaseAudio(); return; }
        await connect();
        if (generation !== lifecycleRef.current || !mountedRef.current) { releaseAudio(); return; }
        if (captureFailedRef.current) useVoice = false;
        if (activeRef.current && !useVoice) { setState('listening'); return; }
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            pendingRef.current = null;
            socketRef.current?.close(1000, '接続がタイムアウトしました。');
            reject(new AppError('会話の開始がタイムアウトしました。サービス設定を確認して、もう一度お試しください。'));
          }, 20_000);
          pendingRef.current = { resolve, reject, timer };
          try { send({ type: 'start', voice: useVoice, sessionId: options.sessionId ?? (activeRef.current ? sessionRef.current?.id : undefined), credentials }); }
          catch (error) { clearTimeout(timer); pendingRef.current = null; reject(error); }
        });
      } catch (caught) {
        if (mountedRef.current && generation === lifecycleRef.current) {
          setErrorDetails(describeError(caught instanceof Error ? caught : '会話を開始できませんでした。もう一度お試しください。'));
          setState(activeRef.current ? 'listening' : 'error');
          if (!activeRef.current) releaseAudio();
        }
        throw caught;
      }
    })();
    startRef.current = task;
    void task.finally(() => { if (startRef.current === task) startRef.current = null; }).catch(() => {});
    return task;
  }, [connect, getAudio, reconnect, releaseAudio, resetAvatarEmotion, resetSpeechInput, send, stopSuggestionSpeech, vadSilenceMs]);

  const end = useCallback(async () => {
    ++lifecycleRef.current;
    endingRef.current = true;
    if (reconnectWaitRef.current) { clearTimeout(reconnectWaitRef.current.timer); reconnectWaitRef.current.resolve(); reconnectWaitRef.current = null; }
    resetAvatarEmotion();
    setReplySuggestions(null);
    releaseAudio();
    if (turnRef.current) rememberCancellation(turnRef.current);
    turnRef.current = null;
    voiceRef.current = false; setVoiceEnabled(false); setTranscript('');
    if (pendingRef.current) {
      clearTimeout(pendingRef.current.timer);
      pendingRef.current.reject(new AppError('会話の開始をキャンセルしました。'));
      pendingRef.current = null;
    }
    if (socketRef.current?.readyState === WebSocket.OPEN) send({ type: 'end' });
    else {
      activeRef.current = false; setActive(false);
      setErrorDetails(describeError('接続が切断されました。会話履歴は保存されています。会話の開始ボタンを押して接続し直してください。'));
    }
    if (!activeRef.current) { setState('idle'); endingRef.current = false; }
  }, [releaseAudio, rememberCancellation, resetAvatarEmotion, send]);

  const sendText = useCallback(async (text: string) => {
    if (!text.trim()) return;
    if (text.length > 4000) throw new AppError('メッセージは 4,000 文字以内で入力してください。');
    if (!activeRef.current) await start({ voice: false, sessionId: sessionRef.current?.endedAt ? undefined : sessionRef.current?.id });
    if (reconnectTaskRef.current) await reconnectTaskRef.current;
    if (!activeRef.current || endingRef.current) throw new AppError('まず会話を開始してください。');
    resetAvatarEmotion();
    stopSuggestionSpeech();
    resetSpeechInput();
    setStreamingMessageId(null);
    replySuggestionsRef.current = null;
    setTranscript(''); setPendingTranscript('');
    setReplySuggestions(null);
    ++replayRequestRef.current;
    audioRef.current?.cancelTurn();
    replyGeneratingRef.current = false;
    setPlaybackCaption(null);
    if (turnRef.current) rememberCancellation(turnRef.current);
    send({ type: 'text', text: text.trim() });
  }, [rememberCancellation, resetAvatarEmotion, resetSpeechInput, send, start, stopSuggestionSpeech]);

  const cancel = useCallback(() => {
    resetAvatarEmotion();
    setStreamingMessageId(null);
    if (suggestionSpeechRef.current) { stopSuggestionSpeech(); return; }
    resetSpeechInput();
    replySuggestionsRef.current = null;
    setReplySuggestions(null);
    ++replayRequestRef.current;
    if (turnRef.current) rememberCancellation(turnRef.current);
    audioRef.current?.cancelTurn();
    setPlaybackCaption(null);
    audioLevelRef.current = 0;
    setAudioBusy(false);
    turnRef.current = null;
    replyGeneratingRef.current = false;
    if (socketRef.current?.readyState === WebSocket.OPEN) send({ type: 'cancel' });
    setState(activeRef.current ? 'listening' : 'idle');
  }, [rememberCancellation, resetAvatarEmotion, resetSpeechInput, send, stopSuggestionSpeech]);

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    resetSpeechInput();
    audioRef.current?.setMuted(mutedRef.current || !!suggestionSpeechRef.current);
    setMuted(mutedRef.current);
  }, [resetSpeechInput]);

  const replay = useCallback(async (turnId: string, slow = false) => {
    stopSuggestionSpeech();
    if (!audioRef.current?.canReplay(turnId)) throw new AppError('音声は現在の会話中のみ保存されます。再生できる音声がありません。');
    resetSpeechInput();
    const request = ++replayRequestRef.current;
    // Cancelling before replay keeps upstream generation and client playback in sync.
    if (turnRef.current) {
      const cancelledTurnId = turnRef.current;
      rememberCancellation(cancelledTurnId);
      send({ type: 'cancel', turnId: cancelledTurnId });
      turnRef.current = null;
      resetAvatarEmotion();
      setStreamingMessageId(null);
      replyGeneratingRef.current = false;
      // Wait for server cancellation before starting a replay that it could otherwise stop.
      await new Promise<void>((resolve, reject) => {
        const socket = socketRef.current;
        const timer = setTimeout(() => { socket?.removeEventListener('message', listen); reject(new AppError('返信の停止を確認しています。少し待ってから、再生ボタンを押してください。')); }, 3000);
        function done() { clearTimeout(timer); socket?.removeEventListener('message', listen); resolve(); }
        function listen(message: MessageEvent) {
          try {
            const event = JSON.parse(String(message.data)) as ServerEvent;
            if (event.type === 'turn.cancelled' && event.turnId === cancelledTurnId) done();
          } catch { /* ignore malformed */ }
        }
        socket?.addEventListener('message', listen);
      });
    }
    if (request !== replayRequestRef.current || endingRef.current || !activeRef.current) return;
    await audioRef.current?.replay(turnId, slow);
  }, [rememberCancellation, resetAvatarEmotion, resetSpeechInput, send, stopSuggestionSpeech]);

  const canReplay = useCallback((turnId: string) => audioRef.current?.canReplay(turnId) ?? false, []);
  const setMessageReadingAid = useCallback((messageId: string, content: string, aid: MessageReadingAid) => {
    if (!mountedRef.current) return;
    setMessages(current => current.map(message => message.id === messageId && message.content === content
      ? { ...message, readingAid: aid } : message));
  }, []);
  const loadHistory = useCallback(async (sessionId: string) => {
    if (activeRef.current || startRef.current || endingRef.current) throw new AppError('現在の会話を終了してから、履歴を開いてください。');
    resetAvatarEmotion();
    const result = await api.session(sessionId);
    releaseAudio(); turnRef.current = null;
    setReplySuggestions(null);
    sessionRef.current = result.session; setSession(result.session); setMessages(result.messages); setTranscript('');
  }, [releaseAudio, resetAvatarEmotion]);

  useEffect(() => {
    const lifecycle = lifecycleRef;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      ++lifecycle.current;
      if (reconnectWaitRef.current) { clearTimeout(reconnectWaitRef.current.timer); reconnectWaitRef.current.resolve(); reconnectWaitRef.current = null; }
      if (pendingRef.current) { clearTimeout(pendingRef.current.timer); pendingRef.current.reject(new AppError('ページを閉じました。')); pendingRef.current = null; }
      const socket = socketRef.current; socketRef.current = null;
      socket?.close(1000, 'ページを閉じました。');
      releaseAudio();
    };
  }, [releaseAudio]);

  return {
    state: suggestionSpeech?.status === 'loading' ? 'thinking' as const : audioBusy ? 'speaking' as const : state,
    connected, active, voiceEnabled, muted, session, messages, streamingMessageId, replySuggestions, suggestionSpeech, playbackCaption, transcript, pendingTranscript, error, errorDetails, userSpeaking, vadStatus, avatarEmotion,
    audioLevelRef, start, end, sendText, cancel, toggleMute, replay, canReplay, loadHistory, listenSuggestion, stopSuggestionSpeech, setMessageReadingAid,
    clearAvatarEmotion: resetAvatarEmotion,
    clearError: useCallback(() => setErrorDetails(null), []),
  };
}
