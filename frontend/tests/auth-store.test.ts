import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '../src/stores/auth.store';

describe('Auth Store', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
    });
  });

  it('starts with no user', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('login() sets user and tokens', () => {
    const user = {
      id: '1',
      name: 'Test',
      email: 'test@test.com',
      role: 'STUDENT',
    };
    useAuthStore.getState().login(user, 'access-token', 'refresh-token');

    const state = useAuthStore.getState();
    expect(state.user).toEqual(user);
    expect(state.accessToken).toBe('access-token');
    expect(state.refreshToken).toBe('refresh-token');
    expect(state.isAuthenticated).toBe(true);
  });

  it('logout() clears everything', () => {
    useAuthStore.getState().login(
      { id: '1', name: 'Test', email: 'test@test.com', role: 'STUDENT' },
      'at',
      'rt'
    );
    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('setTokens() updates tokens and marks authenticated', () => {
    useAuthStore.getState().setTokens('new-access', 'new-refresh');

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('new-access');
    expect(state.refreshToken).toBe('new-refresh');
    expect(state.isAuthenticated).toBe(true);
  });

  it('setUser() updates user info', () => {
    const user = { id: '2', name: 'Updated', email: 'u@test.com', role: 'STUDENT' };
    useAuthStore.getState().setUser(user);

    expect(useAuthStore.getState().user).toEqual(user);
  });
});
