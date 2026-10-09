'use client';

import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from './button';
import { Input, type InputProps } from './input';

export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<InputProps, 'type'> & { visibilityLabel?: string }
>(function PasswordInput({ visibilityLabel = 'password', ...props }, forwardedRef) {
  const [visible, setVisible] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const selection = useRef<{ start: number | null; end: number | null } | null>(null);
  const attach = useCallback(
    (element: HTMLInputElement | null) => {
      input.current = element;
      if (typeof forwardedRef === 'function') forwardedRef(element);
      else if (forwardedRef) forwardedRef.current = element;
    },
    [forwardedRef],
  );
  useLayoutEffect(() => {
    const position = selection.current;
    selection.current = null;
    const element = input.current;
    if (!position || !element || position.start === null || position.end === null) return;
    const { start, end } = position;
    element.setSelectionRange(start, end);
    // Some browsers reset the caret after changing the native input type.
    const frame = requestAnimationFrame(() => {
      if (input.current === element) element.setSelectionRange(start, end);
    });
    return () => cancelAnimationFrame(frame);
  }, [visible]);
  useEffect(() => {
    setInteractive(true);
    const hide = () => setVisible(false);
    const concealInactivePage = () => {
      if (document.hidden) hide();
    };
    document.addEventListener('visibilitychange', concealInactivePage);
    window.addEventListener('pageshow', hide);
    return () => {
      document.removeEventListener('visibilitychange', concealInactivePage);
      window.removeEventListener('pageshow', hide);
    };
  }, []);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Input {...props} ref={attach} type={visible ? 'text' : 'password'} />
      <Button
        aria-controls={props.id}
        aria-label={`${visible ? 'Hide' : 'Show'} ${visibilityLabel}`}
        aria-pressed={visible}
        disabled={props.disabled || !interactive}
        onPointerDown={(event) => {
          if (input.current)
            selection.current = {
              start: input.current.selectionStart,
              end: input.current.selectionEnd,
            };
          event.preventDefault();
        }}
        onClick={() => {
          if (!selection.current && input.current)
            selection.current = {
              start: input.current.selectionStart,
              end: input.current.selectionEnd,
            };
          setVisible((value) => !value);
        }}
        type="button"
        variant="secondary"
      >
        {visible ? 'Hide' : 'Show'}
      </Button>
    </div>
  );
});
