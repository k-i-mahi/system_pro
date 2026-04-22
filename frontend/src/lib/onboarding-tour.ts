import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

const STORAGE_KEY = 'cc-onboarding-completed';

export interface TourStep {
  element: string;
  title: string;
  description: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

const DEFAULT_STEPS: TourStep[] = [
  {
    element: 'body',
    title: 'Welcome to Cognitive Copilot',
    description:
      'A 30-second tour: your adaptive tutor with grounded answers, handwriting OCR, and Bayesian mastery tracking.',
  },
  {
    element: '[data-tour="courses"]',
    title: 'Your courses',
    description:
      'Enroll in a course and upload materials. High-quality OCR runs on upload so everything is searchable.',
    side: 'right',
  },
  {
    element: '[data-tour="ai-tutor"]',
    title: 'AI Tutor',
    description:
      'Four modes: Chat (agentic with tools), Ask Course (grounded with citations), Explain (structured), Quiz (adaptive difficulty).',
    side: 'right',
  },
  {
    element: '[data-tour="analytics"]',
    title: 'Analytics & evaluation',
    description:
      'Track your Bayesian mastery per topic. Instructors can open /analytics/evaluation to see LLM observability in real time.',
    side: 'right',
  },
  {
    element: '[data-tour="theme-toggle"]',
    title: 'Dark mode',
    description: 'Toggle light/dark. Your preference is persisted and respects your OS setting.',
    side: 'bottom',
  },
];

export function hasCompletedOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markOnboardingCompleted() {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function resetOnboarding() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function startOnboardingTour(steps: TourStep[] = DEFAULT_STEPS) {
  const tour = driver({
    showProgress: true,
    allowClose: true,
    overlayOpacity: 0.55,
    stagePadding: 4,
    steps: steps.map((s) => ({
      element: s.element,
      popover: {
        title: s.title,
        description: s.description,
        side: s.side,
        align: 'start',
      },
    })),
    onDestroyed: () => {
      markOnboardingCompleted();
    },
  });
  tour.drive();
  return tour;
}

export function maybeStartOnboardingTour() {
  if (hasCompletedOnboarding()) return null;
  return startOnboardingTour();
}
