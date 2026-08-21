"use client";

import { Eye, EyeOff } from "lucide-react";
import { forwardRef, useId, useState } from "react";

import { cn } from "@/lib/utils";

const FIELD_BASE =
  "w-full bg-elevated border border-line-control rounded-[var(--radius-sm)] px-3 py-2.5 text-sm " +
  "text-ink placeholder:text-ink-subtle transition-colors duration-150 " +
  "hover:border-ink-subtle focus:border-ink focus:outline-none " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

export interface FieldProps {
  label?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
}

function FieldShell({
  id,
  label,
  hint,
  error,
  required,
  children,
}: FieldProps & { id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      {label ? (
        <label htmlFor={id} className="block text-[0.8125rem] font-medium text-ink">
          {label}
          {required ? <span className="text-ink-subtle"> *</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p role="alert" className="text-xs text-critical">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    FieldProps {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, hint, error, id, required, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} required={required}>
      <input
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        className={cn(FIELD_BASE, error && "border-critical", className)}
        {...props}
      />
    </FieldShell>
  );
});

export interface PasswordInputProps extends InputProps {
  /** Renders in monospace so ambiguous glyphs stay distinguishable. */
  mono?: boolean;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(
    { className, label, hint, error, id, required, mono = true, ...props },
    ref,
  ) {
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    const [revealed, setRevealed] = useState(false);

    return (
      <FieldShell id={fieldId} label={label} hint={hint} error={error} required={required}>
        <div className="relative">
          <input
            ref={ref}
            id={fieldId}
            type={revealed ? "text" : "password"}
            required={required}
            aria-invalid={error ? true : undefined}
            // Password managers filling our own password manager creates a
            // confusing loop; opt out of browser autofill heuristics.
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className={cn(
              FIELD_BASE,
              "pr-11",
              mono && "font-mono tracking-tight",
              error && "border-critical",
              className,
            )}
            {...props}
          />
          <button
            type="button"
            onClick={() => setRevealed((value) => !value)}
            aria-label={revealed ? "Hide password" : "Show password"}
            className={cn(
              "absolute right-1 top-1/2 -translate-y-1/2 grid place-items-center",
              "size-8 rounded-[var(--radius-sm)] text-ink-subtle",
              "transition-colors hover:bg-tint hover:text-ink active:bg-tint-strong",
            )}
          >
            {revealed ? (
              <EyeOff className="size-4" aria-hidden />
            ) : (
              <Eye className="size-4" aria-hidden />
            )}
          </button>
        </div>
      </FieldShell>
    );
  },
);

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    FieldProps {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, label, hint, error, id, required, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} required={required}>
      <textarea
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        className={cn(FIELD_BASE, "resize-y min-h-20", error && "border-critical", className)}
        {...props}
      />
    </FieldShell>
  );
});
