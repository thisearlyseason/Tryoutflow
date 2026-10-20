'use client';
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { useFormStatus } from 'react-dom';
import { buttonClassName, type ButtonVariant } from './button-styles';
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  unstyled?: boolean;
  variant?: ButtonVariant;
};
export type { ButtonVariant } from './button-styles';
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    busy = false,
    unstyled = false,
    children,
    className,
    disabled = false,
    type = 'button',
    variant = 'primary',
    onClick,
    ...props
  },
  ref,
) {
  const element = useRef<HTMLButtonElement>(null);
  useImperativeHandle(ref, () => element.current!, []);
  const [posting, setPosting] = useState(false);
  const postLock = useRef(false);
  useEffect(() => {
    const formElement = element.current?.form;
    if (
      !formElement ||
      formElement.method.toLowerCase() !== 'post' ||
      formElement.getAttribute('action')?.startsWith('javascript:')
    )
      return;
    let currentSubmit: SubmitEvent | null = null;
    function submit(event: SubmitEvent) {
      // A corrected submit may arrive before the validation-settling task runs.
      if (postLock.current && currentSubmit?.defaultPrevented) {
        postLock.current = false;
        currentSubmit = null;
        setPosting(false);
      }
      if (postLock.current) {
        event.preventDefault();
        return;
      }
      postLock.current = true;
      currentSubmit = event;
      // React delegates validation to a later bubbling listener. A microtask can
      // run between native listeners, before React prevents an invalid submit.
      // Wait for the whole event dispatch before deciding to lock/show progress.
      window.setTimeout(() => {
        if (currentSubmit !== event) return;
        if (event.defaultPrevented) {
          postLock.current = false;
          currentSubmit = null;
          return;
        }
        setPosting(true);
      }, 0);
    }
    function restore() {
      currentSubmit = null;
      postLock.current = false;
      setPosting(false);
    }
    formElement.addEventListener('submit', submit);
    window.addEventListener('pageshow', restore);
    return () => {
      currentSubmit = null;
      formElement.removeEventListener('submit', submit);
      window.removeEventListener('pageshow', restore);
    };
  }, []);
  const form = useFormStatus();
  const statusId = useId();
  const [running, setRunning] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState(false);
  const pending = busy || running || posting || form.pending;
  return (
    <>
      <button
        {...props}
        ref={element}
        aria-busy={pending || undefined}
        aria-describedby={
          [props['aria-describedby'], pending ? statusId : undefined].filter(Boolean).join(' ') ||
          undefined
        }
        className={unstyled ? className : buttonClassName(variant, className)}
        disabled={disabled || pending}
        type={type}
        onClick={(event) => {
          if (lock.current || pending) {
            event.preventDefault();
            return;
          }
          setError(false);
          const result = onClick?.(event) as unknown;
          if (result && typeof (result as Promise<unknown>).then === 'function') {
            lock.current = true;
            setRunning(true);
            // Preserve immediate visible failure when an asynchronous handler rejects.
            void Promise.resolve(result)
              .catch(() => setError(true))
              .finally(() => {
                lock.current = false;
                setRunning(false);
              });
          }
        }}
      >
        {pending ? <span aria-hidden="true" className="action-spinner" /> : null}
        {children}
      </button>
      {pending ? (
        <span id={statusId} aria-live="polite" className="sr-only">
          Working…
        </span>
      ) : null}
      {error ? (
        <span role="alert">This action could not be completed. Please try again.</span>
      ) : null}
    </>
  );
});

// Retain plain HTML button styling and default submit semantics for existing controls.
export const FeedbackButton = forwardRef<HTMLButtonElement, ButtonProps>(function FeedbackButton(
  { type = 'submit', ...props },
  ref,
) {
  return <Button {...props} type={type} unstyled ref={ref} />;
});
