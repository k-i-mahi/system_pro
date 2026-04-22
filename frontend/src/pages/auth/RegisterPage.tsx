import { useState, type FormEvent } from 'react';
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
    role: 'STUDENT' as 'STUDENT' | 'TUTOR',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
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
      toast.error(msg);
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
          <h2 className="text-xl font-semibold mb-6">Create Account</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Full Name</label>
              <input
                type="text"
                className="input"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="Alex Student"
                required
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                placeholder="you@university.edu"
                required
              />
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
                  value={form.password}
                  onChange={(e) => update('password', e.target.value)}
                  placeholder="Min 8 chars, 1 uppercase, 1 number"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
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
