/** @type {import('next').NextConfig} */
const nextConfig = {
  // NOTE: reactStrictMode is intentionally disabled.
  // In development, Strict Mode double-invokes effects (mount → unmount → mount)
  // which was causing two WebSocket connections and two "create-room" messages to
  // be sent on every page load, making room creation slow and unreliable.
  reactStrictMode: false,

  // Allow the LAN IP to load Next.js dev assets (/_next/*) without triggering
  // the cross-origin security block introduced in Next.js 14. This only applies
  // in development — production on Vercel is unaffected.
  allowedDevOrigins: ["192.168.1.7"],
};

module.exports = nextConfig;
