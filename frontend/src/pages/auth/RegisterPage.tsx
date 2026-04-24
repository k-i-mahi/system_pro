import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import toast from 'react-hot-toast';

export default function RegisterPage() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    universityName: '',
    role: 'STUDENT' as 'STUDENT' | 'TUTOR' | 'ADMIN',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const requestSeqRef = useRef(0);

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (formError) setFormError('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    requestSeqRef.current += 1;
    const requestSeq = requestSeqRef.current;
    setFormError('');
    if (!form.password.trim()) {
      setFormError('Password cannot be empty');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', form);
      login(data.data.user, data.data.accessToken, data.data.refreshToken);
      toast.success('Account created!');
      navigate('/routine');
    } catch (err: any) {
      const details = err.response?.data?.error?.details;
      const msg = details?.length
        ? details.map((d: any) => d.message).join('. ')
        : err.response?.data?.error?.message || 'Registration failed';
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
          <h2 className="text-xl font-semibold mb-6">Create Account</h2>
          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
            {formError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {formError}
              </div>
            )}
            <div>
              <label className="label">Full Name</label>
              <input
                type="text"
                className="input"
                name="register_name"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="Alex Student"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="words"
                spellCheck={false}
                required
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                type="text"
                className="input"
                name="register_email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
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
              <label className="label">I am a</label>
              <div className="flex gap-3">
                <label className={`flex-1 p-3 rounded-lg border-2 text-center cursor-pointer transition-colors ${form.role === 'STUDENT' ? 'border-primary bg-primary-light text-primary' : 'border-border text-text-secondary hover:bg-bg-main'}`}>
                  <input type="radio" name="role" value="STUDENT" checked={form.role === 'STUDENT'} onChange={() => update('role', 'STUDENT')} className="hidden" />
                  Student
                </label>
                <label className={`flex-1 p-3 rounded-lg border-2 text-center cursor-pointer transition-colors ${form.role === 'TUTOR' ? 'border-primary bg-primary-light text-primary' : 'border-border text-text-secondary hover:bg-bg-main'}`}>
                  <input type="radio" name="role" value="TUTOR" checked={form.role === 'TUTOR'} onChange={() => update('role', 'TUTOR')} className="hidden" />
                  Tutor
                </label>
                <label className={`flex-1 p-3 rounded-lg border-2 text-center cursor-pointer transition-colors ${form.role === 'ADMIN' ? 'border-primary bg-primary-light text-primary' : 'border-border text-text-secondary hover:bg-bg-main'}`}>
                  <input type="radio" name="role" value="ADMIN" checked={form.role === 'ADMIN'} onChange={() => update('role', 'ADMIN')} className="hidden" />
                  Admin
                </label>
              </div>
            </div>
            <div>
              <label className="label">University</label>
              <input
                type="text"
                className="input"
                value={form.universityName}
                onChange={(e) => update('universityName', e.target.value)}
                placeholder="Your university name"
                required
                minLength={3}
              />
            </div>

            <div>
              <label className="label">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-10"
                  name="register_password"
                  value={form.password}
                  onChange={(e) => update('password', e.target.value)}
                  placeholder="Create a strong password"
                  minLength={8}
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
              <p className="mt-1 text-xs text-text-muted">
                Minimum 8 characters, at least 1 uppercase letter and 1 number.
              </p>
            </div>
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>
          <p className="text-sm text-text-secondary text-center mt-4">
            Already have an account?{' '}
            <Link to="/login" className="text-primary font-medium hover:underline">
              Sign In
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
