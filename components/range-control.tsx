"use client";
import { useEffect, useRef, type ComponentProps } from "react";
import { Slider } from "@/components/ui/slider";

/** Compose the catalog slider while giving its interactive thumb a useful name. */
export function RangeControl({ "aria-label": ariaLabel = "Value", ...props }: ComponentProps<typeof Slider>) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.querySelectorAll('[role="slider"]').forEach(el => el.setAttribute("aria-label", ariaLabel));
  }, [ariaLabel]);
  return <Slider aria-label={ariaLabel} {...props} ref={ref} />;
}
