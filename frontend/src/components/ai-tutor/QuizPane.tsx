import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, ClipboardList, Timer, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { Button } from '../ui/button';
import { Progress } from '../ui/progress';
import { Badge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';
import { cn } from '../../lib/utils';

interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correct: string;
  explanation?: string;
  difficulty?: number;
}

interface QuizBreakdown {
  questionId: string;
  question: string;
  correct: string;
  userAnswer: string;
  isCorrect: boolean;
  explanation?: string;
}

interface QuizResult {
  attemptId?: string;
  score: number;
  total: number;
  percentage: number;
  breakdown: QuizBreakdown[];
  posterior?: {
    alpha: number;
    beta: number;
    mean: number;
    lower: number;
    upper: number;
  };
}

interface Props {
  topicId: string;
  topicTitle?: string;
  onReviewWrongAnswers?: (wrong: QuizBreakdown[]) => void;
}

export function QuizPane({ topicId, topicTitle, onReviewWrongAnswers }: Props) {
  const [questionCount, setQuestionCount] = useState(5);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [timer, setTimer] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (questions.length > 0 && !result) {
      timerRef.current = setInterval(() => setTimer((t) => t + 1), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [questions.length, result]);

  const generate = useMutation({
    mutationFn: () =>
      api
        .post('/ai-tutor/generate-quiz', { topicId, questionCount })
        .then((r) => r.data.data as { questions: QuizQuestion[] }),
    onSuccess: (data) => {
      setQuestions(data.questions || []);
      setAnswers({});
      setResult(null);
      setTimer(0);
    },
    onError: () => toast.error('Failed to generate quiz. Is Ollama running?'),
  });

  const submit = useMutation({
    mutationFn: () =>
      api
        .post('/ai-tutor/submit-quiz', {
          topicId,
          answers: Object.entries(answers).map(([questionId, selected]) => ({
            questionId,
            selected,
          })),
          questions,
          timeTaken: timer,
        })
        .then((r) => r.data.data as QuizResult),
    onSuccess: (data) => {
      setResult(data);
      if (timerRef.current) clearInterval(timerRef.current);
    },
    onError: () => toast.error('Failed to submit quiz'),
  });

  function reset() {
    setQuestions([]);
    setAnswers({});
    setResult(null);
    setTimer(0);
  }

  function formatTimer(s: number) {
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  }

  const answered = Object.keys(answers).length;
  const progress = questions.length ? (answered / questions.length) * 100 : 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-border p-4">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-text-primary">Quiz</h2>
          {topicTitle && (
            <span className="text-sm text-text-secondary">— {topicTitle}</span>
          )}
        </div>
        {questions.length > 0 && !result && (
          <div className="flex items-center gap-1.5 text-sm text-text-secondary">
            <Timer className="h-4 w-4" />
            {formatTimer(timer)}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {!questions.length && !generate.isPending && (
          <div className="space-y-4 py-8 text-center">
            <ClipboardList className="mx-auto h-12 w-12 text-text-secondary" />
            <div>
              <p className="font-medium text-text-primary">Ready to test your knowledge?</p>
              <p className="mt-1 text-sm text-text-secondary">
                Adaptive-difficulty MCQs calibrated to your Beta-posterior mastery.
              </p>
            </div>
            <div className="mx-auto flex max-w-xs items-center gap-2">
              <select
                className="input text-sm"
                value={questionCount}
                onChange={(e) => setQuestionCount(Number(e.target.value))}
                aria-label="Question count"
              >
                {[3, 5, 10, 15, 20].map((n) => (
                  <option key={n} value={n}>
                    {n} questions
                  </option>
                ))}
              </select>
              <Button
                onClick={() => generate.mutate()}
                disabled={!topicId || generate.isPending}
              >
                Generate Quiz
              </Button>
            </div>
            {!topicId && (
              <p className="text-xs text-warning">Select a topic to generate a quiz.</p>
            )}
          </div>
        )}

        {generate.isPending && (
          <div className="space-y-3 py-8">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
            <p className="text-center text-sm text-text-secondary">
              Generating quiz questions…
            </p>
          </div>
        )}

        {questions.length > 0 && !result && (
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between text-xs text-text-secondary">
              <span>
                Answered {answered} / {questions.length}
              </span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} />
          </div>
        )}

        {result && (
          <div className="mb-6 rounded-xl border-2 border-primary/30 bg-primary/5 p-5 text-center">
            <p className="text-4xl font-bold text-primary">{result.percentage}%</p>
            <p className="mt-1 text-text-secondary">
              {result.score} / {result.total} correct · {formatTimer(timer)}
            </p>
            {result.posterior && (
              <div className="mt-4 inline-flex flex-col items-center gap-1 rounded-lg bg-bg-card px-4 py-2">
                <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                  Mastery estimate
                </p>
                <p className="text-lg font-semibold text-text-primary">
                  {Math.round(result.posterior.mean * 100)}%
                </p>
                <p className="text-xs text-text-secondary">
                  95% CI: {Math.round(result.posterior.lower * 100)}% –{' '}
                  {Math.round(result.posterior.upper * 100)}%
                </p>
                <p className="text-[10px] text-text-secondary">
                  Beta(α={result.posterior.alpha.toFixed(1)}, β=
                  {result.posterior.beta.toFixed(1)})
                </p>
              </div>
            )}
            <div className="mt-4 flex justify-center gap-2">
              <Button variant="outline" size="sm" onClick={reset}>
                New Quiz
              </Button>
              {onReviewWrongAnswers && (
                <Button
                  size="sm"
                  onClick={() =>
                    onReviewWrongAnswers(result.breakdown.filter((b) => !b.isCorrect))
                  }
                  disabled={result.breakdown.every((b) => b.isCorrect)}
                >
                  Review with AI
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="space-y-4">
          {questions.map((q, idx) => (
            <div key={q.id} className="rounded-xl border border-border bg-bg-card p-4">
              <div className="mb-3 flex items-start justify-between gap-2">
                <p className="font-medium text-text-primary">
                  <span className="mr-2 text-primary">Q{idx + 1}.</span>
                  {q.question}
                </p>
                {typeof q.difficulty === 'number' && (
                  <Badge variant="secondary">Level {q.difficulty}</Badge>
                )}
              </div>
              <div className="space-y-2">
                {q.options.map((opt) => {
                  const optKey = opt.charAt(0);
                  const isSelected = answers[q.id] === optKey;
                  let style = 'border-border hover:border-primary cursor-pointer';

                  if (result) {
                    if (optKey === q.correct) {
                      style = 'border-accent bg-accent/10';
                    } else if (isSelected && optKey !== q.correct) {
                      style = 'border-danger bg-danger/10';
                    } else {
                      style = 'border-border opacity-60';
                    }
                  } else if (isSelected) {
                    style = 'border-primary bg-primary/10';
                  }

                  return (
                    <button
                      key={opt}
                      onClick={() =>
                        !result &&
                        setAnswers((prev) => ({ ...prev, [q.id]: optKey }))
                      }
                      disabled={!!result}
                      className={cn(
                        'w-full rounded-lg border-2 p-3 text-left text-sm transition-colors',
                        style
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {result && optKey === q.correct && (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />
                        )}
                        {result && isSelected && optKey !== q.correct && (
                          <XCircle className="h-4 w-4 shrink-0 text-danger" />
                        )}
                        {opt}
                      </div>
                    </button>
                  );
                })}
              </div>
              {result && q.explanation && (
                <div className="mt-3 rounded-lg bg-bg-main p-3 text-xs text-text-secondary">
                  <p className="font-medium text-text-primary">Explanation</p>
                  <p className="mt-1 whitespace-pre-wrap">{q.explanation}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {questions.length > 0 && !result && (
        <div className="border-t border-border p-4">
          <Button
            className="w-full"
            onClick={() => submit.mutate()}
            disabled={answered < questions.length || submit.isPending}
          >
            {submit.isPending
              ? 'Submitting…'
              : `Submit Quiz (${answered}/${questions.length} answered)`}
          </Button>
        </div>
      )}
    </div>
  );
}
