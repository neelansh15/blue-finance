"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const DURATION_MS = 240;

export function useAnimatedNumber(target: number) {
  const [value, setValue] = useState(target);
  const displayed = useRef(target);

  useEffect(() => {
    const from = displayed.current;
    if (from === target) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame: number;
    const started = performance.now();

    function update(value: number) {
      displayed.current = value;
      setValue(value);
    }

    function tick(now: number) {
      if (motion.matches) {
        update(target);
        return;
      }

      const progress = Math.min(1, Math.max(0, (now - started) / DURATION_MS));
      const eased = 1 - (1 - progress) ** 3;
      update(progress === 1 ? target : from + (target - from) * eased);

      if (progress < 1) frame = requestAnimationFrame(tick);
    }

    if (motion.matches) {
      update(target);
      return;
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return value;
}

export function AnimatedValue({ value, children }: { value: string; children: ReactNode }) {
  return (
    <>
      <span aria-hidden="true">{children}</span>
      <span className="sr-only">{value}</span>
    </>
  );
}
