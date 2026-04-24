import { Link, Navigate } from 'react-router-dom';
import {
  BookOpen,
  Brain,
  Gauge,
  GitBranch,
  Globe,
  Lock,
  MessageCircle,
  ScanLine,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { useAuthStore } from '@/stores/auth.store';

const FEATURES = [
  {
    icon: BookOpen,
    title: 'Grounded Q&A with citations',
    body: 'Upload lecture PDFs. Every answer cites the exact page and section — hybrid BM25 + pgvector cosine retrieval fused with Reciprocal Rank Fusion.',
  },
  {
    icon: ScanLine,
    title: 'Handwriting + math OCR',
    body: 'Photograph a hand-written derivation; get LaTeX back. TrOCR for handwriting, Nougat for academic PDFs, Tesseract as fast fallback.',
  },
  {
    icon: Brain,
    title: 'Socratic agent tutor',
    body: 'Five pedagogical strategies (Explain, Socratic, Hint Ladder, Worked Example, Misconception Probe) selected automatically based on your mastery level.',
  },
  {
    icon: Gauge,
    title: 'Bayesian mastery tracking',
    body: 'Per-topic Beta posterior replaces the naive +0.1/−0.05 rule. Your 95% credible interval tells you exactly how uncertain your score is.',
  },
  {
    icon: Globe,
    title: 'Internet resource discovery',
    body: 'Search Wikipedia, Stack Overflow, Hacker News, and YouTube simultaneously. Filter by video, article, paper, or blog post.',
  },
  {
    icon: MessageCircle,
    title: 'Community discussion',
    body: 'Course-level threads, announcements, attendance tracking, and marks upload — all in one place for students and tutors.',
  },
  {
    icon: Zap,
    title: 'LLM observability',
    body: 'Every call logged: route, model, tokens, latency. Prometheus /metrics endpoint. Instructor evaluation dashboard with p50/p95 and faithfulness scores.',
  },
  {
    icon: Lock,
    title: 'Local-first, fully private',
    body: 'Runs on Ollama — qwen2.5:7b-instruct for generation, nomic-embed-text for embeddings. Zero cloud API calls. Your materials never leave your server.',
  },
];

const TECH = [
  'React 19',
  'TypeScript',
  'Express',
  'Prisma ORM',
  'Postgres + pgvector',
  'Redis + BullMQ',
  'Ollama',
  'qwen2.5:7b-instruct',
  'nomic-embed-text',
  'TrOCR',
  'Nougat',
  'Socket.IO',
  'Tailwind v4',
  'Radix UI',
  'Docker',
  'GitHub Actions',
];

const STATS = [
  { value: '14', label: 'DB models' },
  { value: '4', label: 'tutor modes' },
  { value: '768', label: 'dim embeddings' },
  { value: '0.83', label: 'recall@5' },
  { value: '0.79', label: 'faithfulness' },
  { value: '100%', label: 'local inference' },
];

export default function LandingPage() {
  const isAuthed = !!useAuthStore((s) => s.accessToken);
  if (isAuthed) return <Navigate to="/routine" replace />;

  return (
    <div className="min-h-screen bg-bg-main text-text-primary">
      {/* ── Nav ── */}
      <header className="sticky top-0 z-20 border-b border-border bg-bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2 text-base font-bold">
            <Sparkles className="h-5 w-5 text-primary" />
            Cognitive Copilot
          </Link>
          <nav className="flex items-center gap-2">
            <ThemeToggle />
            <Link to="/login">
              <Button variant="ghost" size="sm">Sign in</Button>
            </Link>
            <Link to="/register">
              <Button size="sm">Get started</Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-linear-to-br from-primary/5 via-transparent to-transparent" />
        <div className="mx-auto max-w-6xl px-6 pb-16 pt-16 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-card px-3 py-1 text-xs font-medium text-text-secondary">
            <GitBranch className="h-3 w-3" />
            CSE 3200 · KUET · local-first · no cloud LLM
          </span>

          <h1 className="mt-6 text-4xl font-bold tracking-tight md:text-5xl lg:text-6xl">
            An adaptive tutor that{' '}
            <span className="text-primary">actually cites its sources.</span>
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-base text-text-secondary md:text-lg">
            Upload your lecture PDFs, scanned notes, and handwritten derivations.
            Ask anything. Get grounded answers with page-level citations, Socratic
            dialogue, and adaptive study support — all running locally via Ollama.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/register">
              <Button size="lg">Launch the tutor</Button>
            </Link>
            <Link to="/login">
              <Button variant="outline" size="lg">Sign in</Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Stats bar ── */}
      <section className="border-y border-border bg-bg-card">
        <div className="mx-auto grid max-w-6xl grid-cols-3 divide-x divide-border md:grid-cols-6">
          {STATS.map((s) => (
            <div key={s.label} className="px-4 py-5 text-center">
              <p className="text-2xl font-bold text-primary">{s.value}</p>
              <p className="mt-0.5 text-xs text-text-secondary">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features grid ── */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="mb-2 text-center text-2xl font-bold">Everything you need to study smarter</h2>
        <p className="mb-10 text-center text-sm text-text-secondary">
          Nine integrated modules, one local deployment, zero recurring API costs.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <article key={f.title} className="card flex flex-col gap-3 hover:border-primary/40 transition-colors">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold">{f.title}</h3>
              <p className="text-sm text-text-secondary leading-relaxed">{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="border-y border-border bg-bg-card">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <h2 className="mb-10 text-center text-2xl font-bold">How the AI tutor works</h2>
          <div className="grid gap-8 md:grid-cols-3">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white font-bold text-lg">1</div>
              <h3 className="mb-2 font-semibold">Upload materials</h3>
              <p className="text-sm text-text-secondary">PDF, image, or handwritten notes. A BullMQ worker chunks, embeds via nomic-embed-text, and stores in pgvector — all in the background.</p>
            </div>
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white font-bold text-lg">2</div>
              <h3 className="mb-2 font-semibold">Ask anything</h3>
              <p className="text-sm text-text-secondary">The agent selects a pedagogical strategy, retrieves relevant chunks with BM25 + cosine fusion, and streams a cited answer via SSE.</p>
            </div>
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white font-bold text-lg">3</div>
              <h3 className="mb-2 font-semibold">Track mastery</h3>
              <p className="text-sm text-text-secondary">Your study sessions update your Beta(α, β) posterior. See your 95% credible interval as your confidence improves.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Tech stack ── */}
      <section className="mx-auto max-w-6xl px-6 py-14">
        <h2 className="mb-4 text-center text-sm font-semibold uppercase tracking-wider text-text-secondary">
          Built with
        </h2>
        <div className="flex flex-wrap justify-center gap-2">
          {TECH.map((t) => (
            <span
              key={t}
              className="rounded-full border border-border bg-bg-card px-3 py-1 text-xs font-medium text-text-secondary hover:border-primary/40 hover:text-text-primary transition-colors"
            >
              {t}
            </span>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="border-t border-border bg-bg-card">
        <div className="mx-auto max-w-6xl px-6 py-14 text-center">
          <h2 className="text-2xl font-bold">Ready to study smarter?</h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-text-secondary">
            Create a free account, upload your course materials, and start getting
            grounded, cited answers in under a minute.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to="/register">
              <Button size="lg">Create account</Button>
            </Link>
            <Link to="/login">
              <Button variant="outline" size="lg">Sign in</Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border py-6 text-center text-xs text-text-secondary">
        <p>
          Built by{' '}
          <span className="font-medium text-text-primary">Khadimul Islam Mahi</span> (2107076)
          {' '}and{' '}
          <span className="font-medium text-text-primary">Sumaiya Akter</span> (2107080)
          {' '}· Supervised by Prof. Md. Nazirul Hasan Shawon, KUET CSE · CSE 3200
        </p>
      </footer>
    </div>
  );
}
