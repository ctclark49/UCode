// Stub for rate limiting - to be implemented with Vercel KV or Upstash Redis
module.exports = {
  rateLimit: async (identifier) => ({ success: true }),
  checkLimit: async (identifier) => ({ allowed: true })
};
