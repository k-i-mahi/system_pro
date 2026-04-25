import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const requestSeqRef = useRef(0);

  const KUET_EMAIL_RE = /^[a-z0-9]+@([a-z]+\.)?kuet\.ac\.bd$/i;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    requestSeqRef.current += 1;
    const requestSeq = requestSeqRef.current;
    setFormError('');

    const emailEmpty = !email.trim();
    const passwordEmpty = !password.trim();
    const emailInvalid = !KUET_EMAIL_RE.test(email.trim());

    if (emailEmpty && passwordEmpty) {
      setFormError('Email or Password cannot be empty');
      return;
    }
    if (emailEmpty) {
      setFormError('Email cannot be empty');
      return;
    }
    if (emailInvalid && passwordEmpty) {
      setFormError('Incorrect Email and Password');
      return;
    }
    if (passwordEmpty) {
      setFormError('Password cannot be empty');
      return;
    }
    if (emailInvalid) {
      setFormError('Use verified educational mails only');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      login(data.data.user, data.data.accessToken, data.data.refreshToken);
      toast.success('Welcome back!');
      navigate('/routine');
    } catch (err: any) {
      const details = err.response?.data?.error?.details;
      const code = err.response?.data?.error?.code;
      let msg = details?.length
        ? details.map((d: any) => d.message).join('. ')
        : err.response?.data?.error?.message || 'Login failed';
      if (code === 'INVALID_CREDENTIALS' && msg === 'Invalid email or password') {
        msg = 'Account not registered yet. Please sign up!';
      }
      if (requestSeq !== requestSeqRef.current) return;
      setFormError(msg);
    } finally {
      if (requestSeq === requestSeqRef.current) {
        setLoading(false);
      }
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
          <h2 className="text-xl font-semibold mb-6">Sign In</h2>
          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
            {formError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {formError}
              </div>
            )}
            <div>
              <label className="label">Email</label>
              <input
                type="text"
                className="input"
                name="login_email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (formError) setFormError('');
                }}
                placeholder="Enter your educational email"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
              />
              <p className="mt-1 text-xs text-text-muted">
                Use valid format: nameroll@stud.kuet.ac.bd or name@dept.kuet.ac.bd
              </p>
            </div>
            <div>
              <label className="label">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-10"
                  name="login_password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (formError) setFormError('');
                  }}
                  placeholder="Enter your password"
                  autoComplete="new-password"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <p className="mt-1 text-xs text-text-muted">Password must match your registered account password.</p>
            </div>
            <div className="flex items-center justify-between">
              <Link to="/forgot-password" className="text-sm text-primary hover:underline">
                Forgot password?
              </Link>
            </div>
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
          <p className="text-sm text-text-secondary text-center mt-4">
            Don't have an account?{' '}
            <Link to="/register" className="text-primary font-medium hover:underline">
              Sign Up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
