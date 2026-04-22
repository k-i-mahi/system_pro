import { Moon, Sun } from 'lucide-react';
import { Button } from './button';
import { useThemeStore } from '../../stores/theme.store';

export function ThemeToggle() {
  const { resolved, toggle } = useThemeStore();
  const isDark = resolved === 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
