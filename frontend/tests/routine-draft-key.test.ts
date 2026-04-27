import { describe, it, expect } from 'vitest';
import { routineDraftStorageKey } from '../src/pages/routine/RoutinePage';

describe('routineDraftStorageKey', () => {
  it('scopes drafts per user id', () => {
    expect(routineDraftStorageKey('user-abc')).toBe('routine-draft-v1:user-abc');
    expect(routineDraftStorageKey('user-xyz')).toBe('routine-draft-v1:user-xyz');
  });

  it('uses anonymous bucket when logged out', () => {
    expect(routineDraftStorageKey(undefined)).toBe('routine-draft-v1:anonymous');
  });
});
