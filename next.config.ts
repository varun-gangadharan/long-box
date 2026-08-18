import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "comicvine.gamespot.com",
        pathname: "/a/uploads/**",
      },
    ],
  },
};

export default nextConfig;
