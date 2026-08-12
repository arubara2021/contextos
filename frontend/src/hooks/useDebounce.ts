import { useCallback, useEffect, useRef, useState } from "react";

export function useDebounce<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

export function useDebouncedCallback<A extends unknown[]>(
  callback: (...args: A) => void,
  delayMs = 300
) {
  const saved = useRef(callback);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    saved.current = callback;
  });

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  return useCallback(
    (...args: A) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => saved.current(...args), delayMs);
    },
    [delayMs]
  );
}