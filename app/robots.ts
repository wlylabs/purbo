import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // The vault and its API are behind authentication; keep them out of
      // crawl queues regardless.
      disallow: ["/vault", "/api/"],
    },
  };
}
