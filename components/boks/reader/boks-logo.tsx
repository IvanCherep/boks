/** v44 includes the pumpkin; the decoration remains explicit, with no calendar rule. */
export function BoksLogo({ series = false, seasonal = true, className = "" }: {
  series?: boolean;
  seasonal?: boolean;
  className?: string;
}) {
  return <span className={`boks-logo ${className}`}>
    boks{series && <span className="boks-logo__series">Series</span>}
    {seasonal && !series && <img className="boks-logo__season" src="/design/october-pumpkin-v34.png" alt="" />}
  </span>;
}
