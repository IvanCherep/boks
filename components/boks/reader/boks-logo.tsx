/**
 * v44 includes the pumpkin, the Series wordmark too; the decoration remains
 * explicit (`seasonal`), with no calendar rule. The text-reading header turns it off.
 */
export function BoksLogo({ series = false, seasonal = true, className = "" }: {
  series?: boolean;
  seasonal?: boolean;
  className?: string;
}) {
  return <span className={`boks-logo ${className}`}>
    boks{series && <span className="boks-logo__series">Series</span>}
    {seasonal && <img className="boks-logo__season" src="/design/october-pumpkin-v34.png" alt="" />}
  </span>;
}
