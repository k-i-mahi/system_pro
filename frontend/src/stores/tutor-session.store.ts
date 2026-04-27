import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatMessage } from '@/components/ai-tutor/chat-types';
import type { Citation } from '@/components/ai-tutor/CitationChip';

export type PersistedAskAnswer = {
  question: string;
  body: string;
  citations: Citation[];
  loading: boolean;
};

type SessionSlice = {
  chatMessages: ChatMessage[];
  chatInput: string;
  askAnswers: PersistedAskAnswer[];
  askQuestion: string;
};

function emptySlice(): SessionSlice {
  return {
    chatMessages: [],
    chatInput: '',
    askAnswers: [],
    askQuestion: '',
  };
}

type TutorSessionState = {
  byKey: Record<string, SessionSlice>;
  setChatMessages: (
    key: string,
    updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])
  ) => void;
  setChatInput: (key: string, value: string) => void;
  setAskAnswers: (
    key: string,
    updater: PersistedAskAnswer[] | ((prev: PersistedAskAnswer[]) => PersistedAskAnswer[])
  ) => void;
  setAskQuestion: (key: string, value: string) => void;
  clearAll: () => void;
};

export const useTutorSessionStore = create<TutorSessionState>()(
  persist(
    (set) => ({
      byKey: {},
      setChatMessages: (key, updater) =>
        set((s) => {
          const slice = { ...emptySlice(), ...s.byKey[key] };
          const next =
            typeof updater === 'function'
              ? (updater as (p: ChatMessage[]) => ChatMessage[])(slice.chatMessages)
              : updater;
          return { byKey: { ...s.byKey, [key]: { ...slice, chatMessages: next } } };
        }),
      setChatInput: (key, value) =>
        set((s) => {
          const slice = { ...emptySlice(), ...s.byKey[key] };
          return { byKey: { ...s.byKey, [key]: { ...slice, chatInput: value } } };
        }),
      setAskAnswers: (key, updater) =>
        set((s) => {
          const slice = { ...emptySlice(), ...s.byKey[key] };
          const next =
            typeof updater === 'function'
              ? (updater as (p: PersistedAskAnswer[]) => PersistedAskAnswer[])(slice.askAnswers)
              : updater;
          return { byKey: { ...s.byKey, [key]: { ...slice, askAnswers: next } } };
        }),
      setAskQuestion: (key, value) =>
        set((s) => {
          const slice = { ...emptySlice(), ...s.byKey[key] };
          return { byKey: { ...s.byKey, [key]: { ...slice, askQuestion: value } } };
        }),
      clearAll: () => set({ byKey: {} }),
    }),
    {
      name: 'tutor-session-v1',
      partialize: (state) => ({
        byKey: Object.fromEntries(
          Object.entries(state.byKey).map(([k, slice]) => [
            k,
            {
              ...slice,
              askAnswers: slice.askAnswers.map((a) => ({ ...a, loading: false })),
            },
          ])
        ),
      }),
    }
  )
);
