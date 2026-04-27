import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LoginPage from '../src/pages/auth/LoginPage';
import RegisterPage from '../src/pages/auth/RegisterPage';

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('LoginPage', () => {
  it('renders login form', () => {
    renderWithProviders(<LoginPage />);

    expect(screen.getByRole('heading', { name: 'Sign In' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your educational email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByText(/don't have an account/i)).toBeInTheDocument();
  });

  it('has forgot password link', () => {
    renderWithProviders(<LoginPage />);
    expect(screen.getByText('Forgot password?')).toBeInTheDocument();
  });

  it('renders Cognitive Copilot branding', () => {
    renderWithProviders(<LoginPage />);
    expect(screen.getByText('Cognitive Copilot')).toBeInTheDocument();
    expect(screen.getByText('Academic LMS Platform')).toBeInTheDocument();
  });
});

describe('RegisterPage', () => {
  it('renders registration form', () => {
    renderWithProviders(<RegisterPage />);

    expect(screen.getByRole('heading', { name: 'Create Account' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Alex Student')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your educational email')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Your university name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });

  it('has sign in link', () => {
    renderWithProviders(<RegisterPage />);
    expect(screen.getByText('Sign In')).toBeInTheDocument();
  });
});
