// Global registry that individual tool scripts register themselves into.
// Loaded before any tool script, so `ToolRegistry.register(...)` is always
// available when a tool file runs.
window.ToolRegistry = {
  tools: [],
  // tool: { id, name, render(container, api) -> cleanup?() }
  register(tool) {
    this.tools.push(tool);
  },
};
