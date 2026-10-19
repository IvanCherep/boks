/** The v44 eight-spoke print ornament, independent of a device's emoji font. */
export function BoksFlower({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <path d="M32 5v54M5 32h54M13 13l38 38M13 51l38-38" stroke="currentColor" strokeWidth="3.5" />
  </svg>;
}
