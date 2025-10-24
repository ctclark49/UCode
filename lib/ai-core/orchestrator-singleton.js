// Stub for serverless - to be replaced with E2B.dev integration
module.exports = {
  getInstance() {
    return {
      orchestrate: async (task) => {
        throw new Error('Orchestrator not yet implemented - will use E2B.dev sandboxes');
      }
    };
  }
};
