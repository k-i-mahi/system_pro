import { describe, it, expect } from 'vitest';
import { useUIStore } from '../src/stores/ui.store';

describe('UI Store', () => {
  it('starts with sidebar not collapsed', () => {
    const state = useUIStore.getState();
    expect(state.sidebarCollapsed).toBe(false);
  });

  it('toggleSidebar() toggles collapsed state', () => {
    const store = useUIStore.getState();
    store.toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
    store.toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });
});
