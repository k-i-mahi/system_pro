import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import RoleRoute from '../src/components/auth/RoleRoute';
import { useAuthStore } from '../src/stores/auth.store';

function DummyTutorPage() {
  return <div>Tutor AI blocked</div>;
}

describe('RoleRoute /ai-tutor', () => {
  it('redirects tutors away from student-only route (default /routine)', () => {
    useAuthStore.setState({
      user: {
        id: 't1',
        name: 'Tutor',
        email: 't@cse.kuet.ac.bd',
        role: 'TUTOR',
      },
      isAuthenticated: true,
      accessToken: 'x',
      refreshToken: 'y',
    });

    render(
      <MemoryRouter initialEntries={['/ai-tutor']}>
        <Routes>
          <Route
            path="/ai-tutor"
            element={
              <RoleRoute allowedRoles={['STUDENT']}>
                <DummyTutorPage />
              </RoleRoute>
            }
          />
          <Route path="/routine" element={<div data-testid="routine-fallback">Routine</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('routine-fallback')).toBeInTheDocument();
    expect(screen.queryByText('Tutor AI blocked')).not.toBeInTheDocument();
  });
});
