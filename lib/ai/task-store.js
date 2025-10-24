// Stub for serverless - to be replaced with Supabase storage
module.exports = {
  async saveTask(task) {
    throw new Error('Task store not yet implemented - will use Supabase');
  },
  async getTask(taskId) {
    throw new Error('Task store not yet implemented - will use Supabase');
  }
};
