import * as React from "react";

interface ComposerInputProps {
  value: string;
  disabled: boolean;
  canSend: boolean;
  onValueChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

export function ComposerInput({
  value,
  disabled,
  canSend,
  onValueChange,
  onSubmit
}: ComposerInputProps): React.ReactElement {
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const highlightRef = React.useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = React.useState(value);

  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  React.useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }

    autosize(input);
  }, [draft]);

  React.useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return undefined;
    }

    const resizeInput = (): void => {
      autosize(input);
    };
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resizeInput);

    if (input.parentElement) {
      observer?.observe(input.parentElement);
    }
    window.addEventListener("resize", resizeInput);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resizeInput);
    };
  }, []);

  const updateValue = (nextValue: string): void => {
    setDraft(nextValue);
    onValueChange(nextValue);
  };

  return (
    <div className="vault-ai-assistant-composer-input-stack">
      <div
        ref={highlightRef}
        className="vault-ai-assistant-composer-input-highlight"
        aria-hidden="true"
      >
        {draft}
      </div>
      <textarea
        ref={inputRef}
        className="vault-ai-assistant-composer-input"
        placeholder="Ask about attached context"
        value={draft}
        disabled={disabled}
        onChange={(event) => {
          updateValue(event.currentTarget.value);
        }}
        onScroll={(event) => {
          if (!highlightRef.current) {
            return;
          }
          highlightRef.current.scrollTop = event.currentTarget.scrollTop;
          highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (canSend) {
              onSubmit(draft);
            }
          }
        }}
      />
    </div>
  );
}

function autosize(input: HTMLTextAreaElement): void {
  const { minHeight, maxHeight } = getAutosizeBounds(input);

  input.style.height = "auto";
  input.style.height = `${Math.min(Math.max(input.scrollHeight, minHeight), maxHeight)}px`;
}

function getAutosizeBounds(input: HTMLTextAreaElement): {
  minHeight: number;
  maxHeight: number;
} {
  const view = input.closest(".vault-ai-assistant-view") as HTMLElement | null;
  const viewWidth = view?.clientWidth ?? Number.POSITIVE_INFINITY;
  const viewportIsCompact =
    typeof window !== "undefined" && window.matchMedia("(max-width: 420px)").matches;

  if (viewWidth <= 420 || viewportIsCompact) {
    return {
      minHeight: 58,
      maxHeight: 132
    };
  }

  return {
    minHeight: 88,
    maxHeight: 180
  };
}
