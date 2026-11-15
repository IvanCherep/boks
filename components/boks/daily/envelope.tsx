"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * The envelope a line travels in. Drawn in CSS (`app/daily.css`): a back, the
 * paper, the front pocket and the flap, so the paper can rise out of it and
 * sink back in. `state` drives the motion:
 *
 * - `sealed`  flap closed, paper inside (the home prompt, a letter loading);
 * - `opening` the flap lifts and the paper rises - once, then `open`;
 * - `open`    paper out, flap back, no motion (a letter seen before);
 * - `closing` the paper sinks in and the flap closes (a line being sent);
 * - `away`    a sealed envelope leaves upwards.
 *
 * Motion is decoration: with reduced motion every state is shown at rest.
 */
export type EnvelopeState = "sealed" | "opening" | "open" | "closing" | "away";

export function Envelope({ state, size = "letter", children, className = "", style }: {
  state: EnvelopeState;
  size?: "letter" | "small";
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return <div className={`daily-envelope daily-envelope--${size} ${className}`} data-state={state} style={style}>
    <div className="daily-envelope__back" aria-hidden="true" />
    {children !== undefined && <div className="daily-envelope__paper">{children}</div>}
    <div className="daily-envelope__front" aria-hidden="true" />
    <div className="daily-envelope__flap" aria-hidden="true"><i className="daily-envelope__seal" /></div>
  </div>;
}
