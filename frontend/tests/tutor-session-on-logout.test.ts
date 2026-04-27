import { describe, it, expect, vi, beforeEach } from 'vitest';

const { clearAllMock } = vi.hoisted(() => ({ clearAllMock: vi.fn() }));

vi.mock('../src/stores/tutor-session.store', () => ({
  useTutorSessionStore: {
    getState: () => ({ clearAll: clearAllMock }),
  },
}));

import { useAuthStore } from '../src/stores/auth.store';

describe('Auth logout vs tutor session', () => {
  beforeEach(() => {
    clearAllMock.mockClear();
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
    });
  });

  it('logout clears persisted AI tutor chat / ask-course state', () => {
    useAuthStore.getState().login(
      { id: '1', name: 'S', email: 's@test.com', role: 'STUDENT' },
      'at',
      'rt'
    );
    useAuthStore.getState().logout();
    expect(clearAllMock).toHaveBeenCalledTimes(1);
  });
});
