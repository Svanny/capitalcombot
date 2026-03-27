import { useEffect, useId, useRef, useState } from "react";

interface WindowHelpButtonProps {
  hints: string[];
  title: string;
}

export function WindowHelpButton({ hints, title }: WindowHelpButtonProps) {
  const [open, setOpen] = useState(false);
  const helpId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const closeHelp = () => {
    setOpen(false);
    window.setTimeout(() => {
      buttonRef.current?.focus();
    }, 0);
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeHelp();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="window-help">
      <button
        ref={buttonRef}
        type="button"
        className="window-help-button"
        aria-controls={helpId}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Help for ${title}`}
        onClick={() => setOpen((current) => !current)}
      >
        ?
      </button>

      {open ? (
        <div className="window-help-overlay" onClick={closeHelp}>
          <div
            id={helpId}
            className="window window-help-dialog"
            role="dialog"
            aria-label={`${title} help`}
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="title-bar window-help-title-bar">
              <div className="title-bar-text">{title} Help</div>
              <button
                type="button"
                className="window-help-close"
                aria-label={`Close help for ${title}`}
                onClick={closeHelp}
              >
                ×
              </button>
            </div>
            <div className="window-body">
              <ul className="window-help-list">
                {hints.map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
