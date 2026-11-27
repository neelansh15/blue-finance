import Image from "next/image";

const TOKEN_IMAGES = {
  NVDAB: "/assets/tokens/nvdab.png",
  TSLAB: "/assets/tokens/tslab.png",
  AAPLB: "/assets/tokens/aaplb.png",
  QQQB: "/assets/tokens/qqqb.png",
  SPCXB: "/assets/tokens/spcxb.png",
  GOOGLB: "/assets/tokens/googlb.png",
  USDT: "/assets/tokens/usdt.png",
} as const;

export default function TokenIcon({
  symbol,
  size = 32,
}: {
  symbol: keyof typeof TOKEN_IMAGES;
  size?: number;
}) {
  return <Image src={TOKEN_IMAGES[symbol]} alt="" width={size} height={size} unoptimized />;
}
