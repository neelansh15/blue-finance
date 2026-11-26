import Image from "next/image";
import "./brand-logo.css";

const assets = "/assets/brand";

export const brandMark = `${assets}/blue-finance-mark.png`;

export default function BrandLogo() {
  return (
    <span className="brand-logo" aria-hidden="true">
      <Image className="brand-logo-light" src={`${assets}/blue-finance.png`} alt="" width={720} height={118} />
      <Image className="brand-logo-dark" src={`${assets}/blue-finance-dark.png`} alt="" width={720} height={118} />
      <Image className="brand-logo-mark" src={brandMark} alt="" width={320} height={320} />
    </span>
  );
}
