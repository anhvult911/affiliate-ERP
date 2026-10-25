import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      // Product review images and post captures come from marketplaces / social CDNs.
      { protocol: "https", hostname: "**.shopee.vn" },
      { protocol: "https", hostname: "**.shopee.com" },
      { protocol: "https", hostname: "**.slatic.net" },
      { protocol: "https", hostname: "**.susercontent.com" },
      { protocol: "https", hostname: "**.fbcdn.net" },
      { protocol: "https", hostname: "**.lazada.com" },
      { protocol: "https", hostname: "**.lazcdn.com" },
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "**.supabase.in" }
    ]
  }
};

export default nextConfig;
