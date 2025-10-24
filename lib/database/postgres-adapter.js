// Stub for database adapter - using Supabase client instead
module.exports = {
  query: async (sql, params) => { throw new Error('Use Supabase client directly'); },
  connect: async () => {},
  disconnect: async () => {}
};
