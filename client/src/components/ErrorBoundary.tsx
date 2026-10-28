import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/** When the page last reloaded itself after an error (see shouldAutoReload). */
export const AUTO_RELOAD_KEY = "ldr:error-auto-reload-at";

/**
 * Oct 28, 2026: a page left open across a release runs the old code against the new server and can break on the
 * first new answer. One automatic reload picks up the release; a second error within a minute is a real fault and
 * shows the message instead of reloading in a loop.
 */
export function shouldAutoReload(lastReloadAt: number | null, now: number): boolean {
  return !lastReloadAt || now - lastReloadAt > 60_000;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch() {
    try {
      const last = Number(window.sessionStorage.getItem(AUTO_RELOAD_KEY)) || null;
      if (shouldAutoReload(last, Date.now())) {
        window.sessionStorage.setItem(AUTO_RELOAD_KEY, String(Date.now()));
        window.location.reload();
      }
    } catch {
      // Storage blocked (private mode): the message below offers the reload instead.
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen p-8 bg-background">
          <div className="flex flex-col items-center w-full max-w-2xl p-8 text-center">
            <AlertTriangle
              size={48}
              className="text-destructive mb-6 flex-shrink-0"
            />

            <h2 className="text-xl mb-2">Something went wrong loading this page.</h2>
            <p className="mb-6 text-sm text-muted-foreground">Reloading usually fixes it. If it keeps happening, let us know.</p>

            <button
              onClick={() => window.location.reload()}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg",
                "bg-primary text-primary-foreground",
                "hover:opacity-90 cursor-pointer"
              )}
            >
              <RotateCcw size={16} />
              Reload Page
            </button>

            <details className="mt-8 w-full text-left">
              <summary className="cursor-pointer text-xs text-muted-foreground">Technical details</summary>
              <div className="mt-2 p-4 w-full rounded bg-muted overflow-auto">
                <pre className="text-sm text-muted-foreground whitespace-break-spaces">
                  {this.state.error?.stack}
                </pre>
              </div>
            </details>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
