/** @type {import('next').NextConfig} */
const nextConfig = {
  // NOTE: reactStrictMode is intentionally disabled.
  // In development, Strict Mode double-invokes effects (mount → unmount → mount)
  // which was causing two WebSocket connections and two "create-room" messages to
  // be sent on every page load, making room creation slow and unreliable.
  reactStrictMode: false,
};

module.exports = nextConfig;
