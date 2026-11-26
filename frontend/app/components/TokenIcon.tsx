import Image from "next/image";

const TOKEN_IMAGES = {
  NVDAB: "/assets/tokens/nvdab.png",
  TSLAB: "/assets/tokens/tslab.png",
  AAPLB: "/assets/tokens/aaplb.png",
  QQQB: "/assets/tokens/qqqb.png",
  SPCXB: "/assets/tokens/spcxb.png",
  USDT: "/assets/tokens/usdt.png",
} as const;

// Symbols without a bundled image render a neutral lettered badge.
const FALLBACK_SYMBOLS = ["GOOGLB"] as const;

export default function TokenIcon({
  symbol,
  size = 32,
}: {
  symbol: keyof typeof TOKEN_IMAGES | (typeof FALLBACK_SYMBOLS)[number];
  size?: number;
}) {
  if (!(symbol in TOKEN_IMAGES)) {
    return (
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none",
          width: size, height: size, borderRadius: "50%", border: "1px solid currentColor",
          fontSize: size * 0.4, fontWeight: 600, lineHeight: 1,
        }}
      >
        {symbol[0]}
      </span>
    );
  }
  return <Image src={TOKEN_IMAGES[symbol as keyof typeof TOKEN_IMAGES]} alt="" width={size} height={size} unoptimized />;
}
