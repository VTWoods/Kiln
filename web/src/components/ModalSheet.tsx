import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";

export interface ModalSheetProps {
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  maxWidthClass?: string;
  bodyClassName?: string;
  closeDisabled?: boolean;
  ariaLabel?: string;
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}

interface ModalStackEntry {
  onClose: () => void;
  closeDisabled: boolean;
}

let openModalCount = 0;
let savedBodyOverflow = "";
const modalStack: ModalStackEntry[] = [];

export default function ModalSheet({
  onClose,
  title,
  subtitle,
  header,
  footer,
  maxWidthClass = "sm:max-w-lg",
  bodyClassName = "flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6",
  closeDisabled = false,
  ariaLabel,
  onSubmit,
  children,
}: ModalSheetProps) {
  const titleId = useId();
  const pointerDownOnBackdropRef = useRef(false);
  const entryRef = useRef<ModalStackEntry>({ onClose, closeDisabled });

  useEffect(() => {
    entryRef.current.onClose = onClose;
    entryRef.current.closeDisabled = closeDisabled;
  }, [onClose, closeDisabled]);

  useEffect(() => {
    if (openModalCount === 0) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    openModalCount += 1;

    const entry = entryRef.current;
    modalStack.push(entry);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (modalStack[modalStack.length - 1] !== entry) return;
      if (entry.closeDisabled) return;
      e.preventDefault();
      entry.onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      const idx = modalStack.lastIndexOf(entry);
      if (idx !== -1) {
        modalStack.splice(idx, 1);
      }
      openModalCount = Math.max(0, openModalCount - 1);
      if (openModalCount === 0) {
        document.body.style.overflow = savedBodyOverflow;
      }
    };
  }, []);

  const hasDefaultTitle = header === undefined && title !== undefined;

  const content = (
    <>
      <div className={bodyClassName}>{children}</div>
      {footer !== undefined && footer !== null && (
        <div className="shrink-0 border-t border-stone-100 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
          {footer}
        </div>
      )}
    </>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/50 p-0 backdrop-blur-xs sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={!ariaLabel && hasDefaultTitle ? titleId : undefined}
      onPointerDown={(e) => {
        pointerDownOnBackdropRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (
          pointerDownOnBackdropRef.current &&
          e.target === e.currentTarget &&
          !closeDisabled
        ) {
          onClose();
        }
        pointerDownOnBackdropRef.current = false;
      }}
    >
      <div
        className={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl ring-1 ring-stone-200 sm:max-h-[90dvh] sm:rounded-2xl ${maxWidthClass}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-stone-100 px-4 py-3 sm:px-6 sm:py-4">
          {header !== undefined ? (
            <div className="min-w-0 flex-1">{header}</div>
          ) : (
            <div className="min-w-0 flex-1">
              {title !== undefined && (
                <h2
                  id={titleId}
                  className="text-lg font-semibold text-stone-900"
                >
                  {title}
                </h2>
              )}
              {subtitle !== undefined && (
                <div className="mt-0.5 text-xs text-stone-500">{subtitle}</div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              if (!closeDisabled) onClose();
            }}
            disabled={closeDisabled}
            aria-label="Close"
            className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 active:bg-stone-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden="true" className="text-base leading-none">
              ✕
            </span>
          </button>
        </div>

        {onSubmit ? (
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            {content}
          </form>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">{content}</div>
        )}
      </div>
    </div>
  );
}
