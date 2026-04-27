import { describe, it, expect, beforeEach } from 'vitest';
import { useTutorSessionStore } from '../src/stores/tutor-session.store';

describe('useTutorSessionStore', () => {
  beforeEach(() => {
    useTutorSessionStore.setState({ byKey: {} });
  });

  it('keeps chat messages per session key (survives in-memory navigation patterns)', () => {
    const key = 'course1:topic1';
    useTutorSessionStore.getState().setChatMessages(key, [{ role: 'user', content: 'Hello' }]);
    expect(useTutorSessionStore.getState().byKey[key]?.chatMessages).toHaveLength(1);
    useTutorSessionStore.getState().setAskQuestion(key, 'Q?');
    expect(useTutorSessionStore.getState().byKey[key]?.askQuestion).toBe('Q?');
  });
});
