// Builds the sidebar + content area from whatever tools have registered
// themselves into window.ToolRegistry by the time this script runs.
(function () {
  const toolListEl = document.getElementById('tool-list');
  const contentEl = document.getElementById('content');
  const tools = window.ToolRegistry.tools;

  let activeCleanup = null;
  let activeId = null;

  function selectTool(tool) {
    if (activeCleanup) {
      try {
        activeCleanup();
      } catch (err) {
        console.error(`cleanup failed for tool "${activeId}"`, err);
      }
      activeCleanup = null;
    }

    activeId = tool.id;
    for (const li of toolListEl.querySelectorAll('li')) {
      li.classList.toggle('active', li.dataset.toolId === tool.id);
    }

    contentEl.innerHTML = '';
    const cleanup = tool.render(contentEl, window.api);
    if (typeof cleanup === 'function') activeCleanup = cleanup;
  }

  if (tools.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No tools yet';
    toolListEl.appendChild(li);
    return;
  }

  for (const tool of tools) {
    const li = document.createElement('li');
    li.textContent = tool.name;
    li.dataset.toolId = tool.id;
    li.addEventListener('click', () => selectTool(tool));
    toolListEl.appendChild(li);
  }

  selectTool(tools[0]);
})();
