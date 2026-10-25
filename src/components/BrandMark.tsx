export default function BrandMark({ size = 35 }: { size?: number }) {
  return <span className="brand-mark" aria-label="SoraLink"><img src="/images/soralink-logo.jpg" alt="SoraLink" width={size} height={size} /></span>;
}
