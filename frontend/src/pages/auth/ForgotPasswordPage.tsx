import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import api from '@/lib/api';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    setSuccessMessage('');
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSuccessMessage('A password reset link has been sent. Please check your inbox.');
    } catch (err: any) {
      const details = err.response?.data?.error?.details;
      const msg = details?.length
        ? details.map((d: any) => d.message).join('. ')
        : err.response?.data?.error?.message || 'Failed to send password reset link';
      setFormError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-main p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary-dark">Cognitive Copilot</h1>
          <p className="text-text-secondary mt-2">Academic LMS Platform</p>
        </div>

        <div className="card">
          <Link
            to="/login"
            className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-primary mb-4"
          >
            <ArrowLeft size={16} />
            Back to Sign In
          </Link>

          <h2 className="text-xl font-semibold mb-2">Forgot Password</h2>
          <p className="text-sm text-text-secondary mb-6">
            Enter your email to receive a password reset link.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {formError}
              </div>
            )}
            {successMessage && (
              <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                {successMessage}
              </div>
            )}
            <div>
              <label className="label">Email</label>
              <input
                type="text"
                className="input"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (formError) setFormError('');
                }}
                placeholder="you@university.edu"
              />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
            <button type="button" className="btn-secondary w-full" onClick={() => navigate('/login')}>
              Back to Sign In
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
