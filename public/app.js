(function() {
  const STATUS_COLORS = {
    active: '#c96342',
    onhold: '#d4a84b',
    completed: '#5a8a5a',
    idea: '#7a9eb8'
  };
  const STATUS_LABELS = {
    active: 'Active',
    onhold: 'On hold',
    completed: 'Completed',
    idea: 'Idea'
  };

  const NODE_COLORS = [
    { label: 'Terracotta', value: '#c96342' },
    { label: 'Amber',      value: '#d4a84b' },
    { label: 'Sage',       value: '#5a8a5a' },
    { label: 'Steel',      value: '#7a9eb8' },
    { label: 'Violet',     value: '#8b5cf6' },
    { label: 'Rose',       value: '#e07b8a' },
    { label: 'Teal',       value: '#3a9e8a' },
    { label: 'Slate',      value: '#6b7280' },
  ];

  let data = null;
  let links = [];
  let allTags = [];

  const state = {
    expanded: new Set(['root', 'p1']),
    selected: null,
    pan: { x: 0, y: 0 },
    zoom: 1,
    dragging: false,
    dragStart: null,
    didDrag: false,
    searchMatches: new Set(),
    linking: false,
    linkSource: null,
    linkSourceCenter: null,
    linkCursor: null,
    viewRoot: 'root',
    viewStack: ['root'],
    viewState: { root: { pan: { x: 0, y: 0 }, zoom: 1, expanded: new Set(['root', 'p1']) } },
    // Which path-row is being edited inline. shape: { nodeId, idx } or { nodeId, idx: -1 } for new
    editingPath: null,
    nodeDrag: null,
    nodeDragActive: false,
    nodeDragTarget: null
  };

  async function api(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    if (!res.ok) { showToast('Error: ' + res.statusText); throw new Error(res.statusText); }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : {};
  }

  const svg = document.getElementById('canvas');
  const canvasWrap = document.getElementById('canvas-wrap');
  const hint = document.getElementById('hint');
  const modalBackdrop = document.getElementById('modal-backdrop');
  const modalContent = document.getElementById('modal-content');
  const sidebar = document.getElementById('sidebar');
  const sidebarContent = document.getElementById('sidebar-content');
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  const zoomLevel = document.getElementById('zoom-level');
  const toast = document.getElementById('toast');
  const breadcrumbs = document.getElementById('breadcrumbs');

  function resolveColor(n) {
    let cur = n;
    while (cur) {
      if (cur.color) return cur.color;
      const parent = findParent(cur.id);
      if (!parent || parent.id === 'root') break;
      cur = parent;
    }
    return STATUS_COLORS[n.status] || '#888';
  }

  function nodeColor(n) {
    if (!n) return '#888';
    if (n.type === 'root' || n.id === state.viewRoot) return '#2a2a28';
    return resolveColor(n);
  }
  function nodeSize(n) {
    if (n.type === 'root' || n.id === state.viewRoot) return { w: 200, h: 56 };
    if (n.type === 'project') return { w: 210, h: 64 };
    return { w: 190, h: 50 };
  }

  function getViewRootNode() { return findNode(state.viewRoot) || data; }

  function buildLayout(n) {
    const isViewRoot = n.id === state.viewRoot;
    const expanded = state.expanded.has(n.id) || isViewRoot;
    const hasChildren = n.children && n.children.length > 0;
    if (!expanded || !hasChildren) return { node: n, rows: 1, children: [] };
    const children = n.children.map(buildLayout);
    const rows = children.reduce((s, c) => s + c.rows, 0);
    return { node: n, rows, children };
  }

  function assignPositions(layout, x, topY, X_GAP, Y_GAP, out = []) {
    if (layout.children.length === 0) {
      out.push({ node: layout.node, x, y: topY + Y_GAP / 2 });
      return out;
    }
    let cy = topY;
    const childYs = [];
    layout.children.forEach(child => {
      const childTop = cy;
      assignPositions(child, x + X_GAP, childTop, X_GAP, Y_GAP, out);
      childYs.push(childTop + (child.rows * Y_GAP) / 2);
      cy += child.rows * Y_GAP;
    });
    const py = (childYs[0] + childYs[childYs.length - 1]) / 2;
    out.push({ node: layout.node, x, y: py });
    return out;
  }

  function findNode(id, n = data) {
    if (!id) return null;
    if (n.id === id) return n;
    if (n.children) for (const c of n.children) {
      const f = findNode(id, c);
      if (f) return f;
    }
    return null;
  }

  function findParent(id, n = data) {
    if (!n.children) return null;
    for (const c of n.children) {
      if (c.id === id) return n;
      const f = findParent(id, c);
      if (f) return f;
    }
    return null;
  }

  function ancestorIds(id) {
    const out = [];
    let cur = findParent(id);
    while (cur) { out.push(cur.id); cur = findParent(cur.id); }
    return out;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }
  function countDescendants(n) {
    if (!n.children || n.children.length === 0) return 0;
    return n.children.reduce((s, c) => s + 1 + countDescendants(c), 0);
  }

  function tagColor(tag) {
    let h = 0;
    for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0;
    const palette = [
      { bg: '#fdecdc', fg: '#a14a2a' },
      { bg: '#e8f0e3', fg: '#3f6535' },
      { bg: '#e3edf5', fg: '#345d7e' },
      { bg: '#f7e9d0', fg: '#7a5a1f' },
      { bg: '#efe3f0', fg: '#6a3a72' },
      { bg: '#dcebe9', fg: '#26615a' },
      { bg: '#f5dfe3', fg: '#84334a' },
      { bg: '#e6e3f0', fg: '#3e3a72' }
    ];
    return palette[Math.abs(h) % palette.length];
  }

  // Returns the count of paths on a node (for indicator)
  function pathCount(n) { return (n.paths || []).length; }

  // Display the tail end of a path so the meaningful part is visible
  function shortenPath(p, maxLen = 36) {
    if (!p) return '';
    if (p.length <= maxLen) return p;
    return '…' + p.slice(p.length - maxLen + 1);
  }

  const screenPos = new Map();

  function render() {
    const viewNode = getViewRootNode();
    const layout = buildLayout(viewNode);
    const X_GAP = 250;
    const Y_GAP = 76;
    const positions = assignPositions(layout, 0, 0, X_GAP, Y_GAP);

    const xs = positions.map(p => p.x);
    const ys = positions.map(p => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const H = canvasWrap.clientHeight;
    const cx = canvasWrap.clientWidth / 2;
    const cy = H / 2;
    const z = state.zoom;

    const baseOffsetX = 80 - minX;
    const baseOffsetY = (H - (maxY - minY)) / 2 - minY;

    const posMap = new Map();
    screenPos.clear();
    positions.forEach(p => {
      const baseX = p.x + baseOffsetX;
      const baseY = p.y + baseOffsetY;
      const sx = cx + (baseX - cx) * z + state.pan.x;
      const sy = cy + (baseY - cy) * z + state.pan.y;
      posMap.set(p.node.id, { x: sx, y: sy });
      screenPos.set(p.node.id, { x: sx, y: sy });
    });

    let edgesHTML = '';
    let nodesHTML = '';

    function renderEdges(n) {
      const isViewRoot = n.id === state.viewRoot;
      if (!(state.expanded.has(n.id) || isViewRoot) || !n.children) return;
      const p = posMap.get(n.id);
      n.children.forEach(c => {
        const cp = posMap.get(c.id);
        if (!cp) return;
        const ns = nodeSize(n);
        const cs = nodeSize(c);
        const x1 = p.x + (ns.w * z) / 2;
        const y1 = p.y;
        const x2 = cp.x - (cs.w * z) / 2;
        const y2 = cp.y;
        const mx = (x1 + x2) / 2;
        const isHl = state.selected === c.id || state.selected === n.id;
        edgesHTML += `<path class="edge ${isHl ? 'highlighted' : ''}" d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}"/>`;
        renderEdges(c);
      });
    }
    renderEdges(viewNode);

    function renderNode(n) {
      const p = posMap.get(n.id);
      if (!p) return;
      const sz = nodeSize(n);
      const w = sz.w * z;
      const h = sz.h * z;
      const isViewRoot = n.id === state.viewRoot;
      const color = nodeColor(n);
      const isSelected = state.selected === n.id;
      const isExpanded = state.expanded.has(n.id);
      const hasChildren = n.children && n.children.length > 0;
      const isMatch = state.searchMatches.has(n.id);
      const isLinkSource = state.linking && state.linkSource === n.id;
      const numPaths = pathCount(n);

      const fillColor = isViewRoot ? '#2a2a28' : 'white';
      const textColor = isViewRoot ? 'white' : '#2a2a28';

      // Status dot
      let statusDot = '';
      if (!isViewRoot && n.type !== 'root') {
        statusDot = `<circle cx="${p.x - w/2 + 14*z}" cy="${p.y - 6*z}" r="${5*z}" fill="${color}"/>`;
      }

      // Folder indicator — just to the right of the status dot, only if paths exist
      let folderIndicator = '';
      if (numPaths > 0 && !isViewRoot && n.type !== 'root' && z >= 0.55) {
        const fx = p.x - w/2 + 28*z;
        const fy = p.y - 6*z;
        folderIndicator = `
          <g class="node-folder-indicator">
            <text x="${fx}" y="${fy + 4*z}" text-anchor="start" style="font-size:${11*z}px">📁</text>
            ${numPaths > 1 ? `<text x="${fx + 13*z}" y="${fy + 4*z}" text-anchor="start" fill="${color}" style="font-size:${10*z}px;font-weight:700">${numPaths}</text>` : ''}
          </g>
        `;
      }

      // Tag chips along the bottom
      let tagsRow = '';
      if (n.tags && n.tags.length > 0 && !isViewRoot && z >= 0.6) {
        const visible = n.tags.slice(0, 2);
        const overflow = n.tags.length - visible.length;
        let chipX = p.x - w/2 + 14*z;
        const chipY = p.y + h/2 - 12*z;
        const chips = [];
        visible.forEach(t => {
          const c = tagColor(t);
          const text = t.length > 12 ? t.slice(0, 10) + '…' : t;
          const tw = (text.length * 5.6 + 14) * z;
          chips.push(`
            <rect x="${chipX}" y="${chipY - 8*z}" width="${tw}" height="${14*z}" rx="${7*z}" fill="${c.bg}"/>
            <text class="node-tag-text" x="${chipX + tw/2}" y="${chipY + 2*z}" text-anchor="middle" fill="${c.fg}" style="font-size:${9.5*z}px">${escapeHtml(text)}</text>
          `);
          chipX += tw + 4*z;
        });
        if (overflow > 0) {
          const tw = 22*z;
          chips.push(`
            <rect x="${chipX}" y="${chipY - 8*z}" width="${tw}" height="${14*z}" rx="${7*z}" fill="#f0ede5"/>
            <text class="node-tag-text" x="${chipX + tw/2}" y="${chipY + 2*z}" text-anchor="middle" fill="#6b6b66" style="font-size:${9.5*z}px">+${overflow}</text>
          `);
        }
        tagsRow = chips.join('');
      }

      let progressBar = '';
      if (!isViewRoot && n.type === 'project' && typeof n.progress === 'number') {
        const barW = w - 28*z;
        const fillW = barW * (n.progress / 100);
        const barY = (n.tags && n.tags.length > 0) ? p.y - 2*z : p.y + 14*z;
        progressBar = `
          <rect class="progress-bg" x="${p.x - barW/2}" y="${barY}" width="${barW}" height="${4*z}" rx="${2*z}"/>
          <rect x="${p.x - barW/2}" y="${barY}" width="${fillW}" height="${4*z}" rx="${2*z}" fill="${color}"/>
        `;
      }

      let expandIcon = '';
      if (hasChildren && !isViewRoot && n.type !== 'root') {
        const ix = p.x + w/2 - 14*z;
        const iy = p.y - 8*z;
        expandIcon = `
          <circle cx="${ix}" cy="${iy}" r="${9*z}" fill="${color}" opacity="0.15"/>
          <text class="expand-icon" x="${ix}" y="${iy + 4*z}" text-anchor="middle" fill="${color}" style="font-size:${14*z}px">${isExpanded ? '−' : '+'}</text>
        `;
      }

      let labelY, labelX, textAnchor;
      if (isViewRoot) {
        labelY = p.y + 4*z;
        labelX = p.x;
        textAnchor = 'middle';
      } else {
        labelY = p.y - 6*z;
        // Offset label right when folder indicator is present so they don't collide
        const labelOffset = (numPaths > 0 && z >= 0.55) ? 50 : 28;
        labelX = p.x - w/2 + labelOffset*z;
        textAnchor = 'start';
      }
      const labelText = n.label.length > 22 ? n.label.slice(0, 20) + '…' : n.label;

      const btnR = 11;
      const btnGap = 4;
      const addBtnX = p.x + w/2 + btnGap + btnR;
      const addBtnY = p.y + h/2 - btnR;
      const addBtn = `
        <g class="node-action" data-action="add" data-id="${n.id}">
          <circle cx="${addBtnX}" cy="${addBtnY}" r="${btnR}" fill="#c96342" stroke="white" stroke-width="2"/>
          <text x="${addBtnX}" y="${addBtnY + 5}" text-anchor="middle" fill="white">+</text>
        </g>
      `;

      let removeBtn = '';
      if (n.type !== 'root' && !isViewRoot) {
        const rmX = p.x + w/2 + btnGap + btnR;
        const rmY = p.y - h/2 + btnR;
        removeBtn = `
          <g class="node-action" data-action="remove" data-id="${n.id}">
            <circle cx="${rmX}" cy="${rmY}" r="${btnR}" fill="#8a8a85" stroke="white" stroke-width="2"/>
            <text x="${rmX}" y="${rmY + 5}" text-anchor="middle" fill="white">×</text>
          </g>
        `;
      }

      let linkBtn = '';
      if (n.type !== 'root' && !isViewRoot) {
        const lkX = p.x + w/2 + btnGap + btnR;
        const lkY = p.y;
        linkBtn = `
          <g class="node-action link-handle" data-action="link" data-id="${n.id}">
            <circle cx="${lkX}" cy="${lkY}" r="${btnR}" fill="#7a9eb8" stroke="white" stroke-width="2"/>
            <text x="${lkX}" y="${lkY + 5}" text-anchor="middle" fill="white" style="font-size:13px">↗</text>
          </g>
        `;
      }

      const classes = [
        'node-group',
        isSelected ? 'selected' : '',
        isMatch ? 'search-match' : '',
        isLinkSource ? 'dragging-source' : ''
      ].filter(Boolean).join(' ');

      nodesHTML += `
        <g class="${classes}" data-id="${n.id}">
          <rect class="node-rect" x="${p.x - w/2}" y="${p.y - h/2}" width="${w}" height="${h}"
                rx="${11*z}" fill="${fillColor}" stroke="${color}" stroke-width="2"/>
          ${statusDot}
          ${folderIndicator}
          <text class="node-text" x="${labelX}" y="${labelY}" text-anchor="${textAnchor}" fill="${textColor}" style="font-size:${13*z}px">${escapeHtml(labelText)}</text>
          ${progressBar}
          ${tagsRow}
          ${expandIcon}
          ${addBtn}
          ${removeBtn}
          ${linkBtn}
        </g>
      `;

      const isExpandedOrViewRoot = state.expanded.has(n.id) || isViewRoot;
      if (isExpandedOrViewRoot && n.children) n.children.forEach(renderNode);
    }
    renderNode(viewNode);

    let dragLine = '';
    if (state.linking && state.linkSourceCenter && state.linkCursor) {
      const sx = state.linkSourceCenter.x, sy = state.linkSourceCenter.y;
      const tx = state.linkCursor.x, ty = state.linkCursor.y;
      dragLine = `<path class="drag-link" d="M ${sx} ${sy} L ${tx} ${ty}"/>
                  <circle cx="${tx}" cy="${ty}" r="5" fill="#c96342"/>`;
    }

    svg.innerHTML = edgesHTML + nodesHTML + dragLine;
    zoomLevel.textContent = Math.round(state.zoom * 100) + '%';

    svg.querySelectorAll('.node-action').forEach(g => {
      const action = g.dataset.action, id = g.dataset.id;
      if (action === 'link') {
        g.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          startLinkDrag(id, e.clientX, e.clientY);
        });
      } else {
        g.addEventListener('click', (e) => {
          e.stopPropagation();
          if (state.didDrag) return;
          if (action === 'add') openAddModal(id);
          else if (action === 'remove') openRemoveModal(id);
        });
      }
    });

    svg.querySelectorAll('.node-group').forEach(g => {
      g.addEventListener('click', (e) => {
        if (e.target.closest('.node-action')) return;
        e.stopPropagation();
        if (state.didDrag || state.nodeDragActive) return;
        handleNodeClick(g.dataset.id);
      });

      g.addEventListener('dblclick', (e) => {
        if (e.target.closest('.node-action')) return;
        e.stopPropagation();
        const id = g.dataset.id;
        const node = findNode(id);
        if (!node || !node.children || node.children.length === 0) return;
        toggleExpand(id);
        render();
      });
    });

    renderBreadcrumbs();
  }

  function renderBreadcrumbs() {
    if (state.viewRoot === 'root') {
      breadcrumbs.classList.remove('visible');
      breadcrumbs.innerHTML = '';
      return;
    }
    breadcrumbs.classList.add('visible');
    const chain = [];
    let cur = findNode(state.viewRoot);
    while (cur) { chain.unshift(cur); cur = findParent(cur.id); }
    const html = chain.map((n, i) => {
      const isLast = i === chain.length - 1;
      const isFirst = i === 0;
      const label = isFirst ? 'All projects' : n.label;
      return `
        ${i > 0 ? '<span class="crumb-sep">›</span>' : ''}
        <button class="crumb ${isLast ? 'current' : ''}" data-id="${n.id}">${escapeHtml(label.length > 26 ? label.slice(0, 24) + '…' : label)}</button>
      `;
    }).join('');
    breadcrumbs.innerHTML = `<button class="crumb" id="back-btn" title="Back to parent view">← Back</button><span class="crumb-sep">·</span>` + html;
    breadcrumbs.querySelectorAll('.crumb').forEach(btn => {
      if (btn.id === 'back-btn') btn.addEventListener('click', popView);
      else if (!btn.classList.contains('current')) btn.addEventListener('click', () => goToView(btn.dataset.id));
    });
  }

  function pushView(nodeId) {
    if (nodeId === state.viewRoot) return;
    const node = findNode(nodeId);
    if (!node) return;
    if (!node.children || node.children.length === 0) {
      showToast('Add sub-items first to open as a mindmap');
      return;
    }
    state.viewState[state.viewRoot] = {
      pan: { ...state.pan }, zoom: state.zoom, expanded: new Set(state.expanded)
    };
    state.viewStack.push(nodeId);
    state.viewRoot = nodeId;
    if (state.viewState[nodeId]) {
      state.pan = { ...state.viewState[nodeId].pan };
      state.zoom = state.viewState[nodeId].zoom;
      state.expanded = new Set(state.viewState[nodeId].expanded);
    } else {
      state.pan = { x: 0, y: 0 };
      state.zoom = 1;
      state.expanded = new Set([nodeId]);
      if (node.children) node.children.forEach(c => {
        if (c.children && c.children.length > 0) state.expanded.add(c.id);
      });
    }
    state.selected = null;
    closeSidebar();
    render();
  }

  function popView() {
    if (state.viewStack.length <= 1) return;
    state.viewState[state.viewRoot] = {
      pan: { ...state.pan }, zoom: state.zoom, expanded: new Set(state.expanded)
    };
    state.viewStack.pop();
    const newRoot = state.viewStack[state.viewStack.length - 1];
    state.viewRoot = newRoot;
    if (state.viewState[newRoot]) {
      state.pan = { ...state.viewState[newRoot].pan };
      state.zoom = state.viewState[newRoot].zoom;
      state.expanded = new Set(state.viewState[newRoot].expanded);
    }
    state.selected = null;
    closeSidebar();
    render();
  }

  function goToView(nodeId) {
    if (nodeId === state.viewRoot) return;
    state.viewState[state.viewRoot] = {
      pan: { ...state.pan }, zoom: state.zoom, expanded: new Set(state.expanded)
    };
    const idx = state.viewStack.indexOf(nodeId);
    if (idx < 0) { pushView(nodeId); return; }
    state.viewStack = state.viewStack.slice(0, idx + 1);
    state.viewRoot = nodeId;
    if (state.viewState[nodeId]) {
      state.pan = { ...state.viewState[nodeId].pan };
      state.zoom = state.viewState[nodeId].zoom;
      state.expanded = new Set(state.viewState[nodeId].expanded);
    }
    state.selected = null;
    closeSidebar();
    render();
  }

  // ---- Linking ----

  function startLinkDrag(sourceId, clientX, clientY) {
    if (!sidebar.classList.contains('open')) {
      showToast('Open another node\'s details first to link to it');
      return;
    }
    if (state.selected === sourceId) {
      showToast('Open the target node, then drag from a different node');
      return;
    }
    state.linking = true;
    state.linkSource = sourceId;
    const center = screenPos.get(sourceId);
    state.linkSourceCenter = center ? { x: center.x, y: center.y } : { x: clientX, y: clientY };
    state.linkCursor = { x: clientX, y: clientY };
    canvasWrap.classList.add('linking');
    render();
  }

  function updateLinkDrag(clientX, clientY) {
    if (!state.linking) return;
    state.linkCursor = { x: clientX, y: clientY };
    const sbRect = sidebar.getBoundingClientRect();
    const overSidebar = sidebar.classList.contains('open') &&
      clientX >= sbRect.left && clientX <= sbRect.right &&
      clientY >= sbRect.top && clientY <= sbRect.bottom;
    sidebar.classList.toggle('drop-target', overSidebar);
    render();
  }

  function endLinkDrag(clientX, clientY) {
    if (!state.linking) return;
    const sbRect = sidebar.getBoundingClientRect();
    const overSidebar = sidebar.classList.contains('open') &&
      clientX >= sbRect.left && clientX <= sbRect.right &&
      clientY >= sbRect.top && clientY <= sbRect.bottom;
    const targetId = state.selected, sourceId = state.linkSource;
    state.linking = false;
    state.linkSource = null;
    state.linkSourceCenter = null;
    state.linkCursor = null;
    canvasWrap.classList.remove('linking');
    sidebar.classList.remove('drop-target');
    if (overSidebar && targetId && sourceId && targetId !== sourceId) addLink(sourceId, targetId);
    render();
  }

  function addLink(fromId, toId) {
    const source_id = fromId, target_id = toId;
    const exists = links.some(l =>
      (l.source_id === source_id && l.target_id === target_id) ||
      (l.source_id === target_id && l.target_id === source_id)
    );
    if (exists) { showToast('These nodes are already linked'); return; }
    links.push({ source_id, target_id });
    api('POST', '/api/links', { source_id, target_id })
      .then(created => { links[links.length - 1].id = created.id; })
      .catch(() => { links.splice(links.length - 1, 1); render(); });
    showToast(`Linked "${findNode(fromId).label}" to "${findNode(toId).label}"`);
    if (state.selected) {
      const sel = findNode(state.selected);
      if (sel) openSidebar(sel);
    }
  }

  function removeLink(fromId, toId) {
    const idx = links.findIndex(l =>
      (l.source_id === fromId && l.target_id === toId) ||
      (l.source_id === toId && l.target_id === fromId)
    );
    if (idx >= 0) {
      const linkId = links[idx].id;
      links = links.filter((_, i) => i !== idx);
      if (linkId !== undefined) api('DELETE', `/api/links/${linkId}`);
      if (state.selected) {
        const sel = findNode(state.selected);
        if (sel) openSidebar(sel);
      }
    }
  }

  function getLinkedNodes(nodeId) {
    return links
      .filter(l => l.source_id === nodeId || l.target_id === nodeId)
      .map(l => l.source_id === nodeId ? l.target_id : l.source_id)
      .map(id => findNode(id))
      .filter(Boolean);
  }

  // ---- Search ----

  function updateSearch(query) {
    state.searchMatches.clear();
    const q = query.trim().toLowerCase();
    if (!q) { searchResults.classList.remove('visible'); render(); return; }
    const matches = [];
    (function walk(n, path) {
      const newPath = n.type === 'root' ? path : [...path, n.label];
      const tagStr = (n.tags || []).join(' ');
      const pathStr = (n.paths || []).map(p => `${p.label || ''} ${p.path || ''}`).join(' ');
      const haystack = (n.label + ' ' + (n.notes || '') + ' ' + tagStr + ' ' + pathStr).toLowerCase();
      if (n.type !== 'root' && haystack.includes(q)) matches.push({ node: n, path: newPath });
      if (n.children) n.children.forEach(c => walk(c, newPath));
    })(data, []);

    matches.slice(0, 8).forEach(m => state.searchMatches.add(m.node.id));

    if (matches.length === 0) {
      searchResults.innerHTML = `<div class="search-result-empty">No matches for "${escapeHtml(query)}"</div>`;
    } else {
      searchResults.innerHTML = matches.slice(0, 8).map((m) => {
        const meta = m.path.slice(0, -1).join(' › ') || ((m.node.tags || []).join(', '));
        return `<div class="search-result" data-id="${m.node.id}">
          <div class="search-result-label">${highlightMatch(m.node.label, q)}</div>
          ${meta ? `<div class="search-result-meta">${escapeHtml(meta)}</div>` : ''}
        </div>`;
      }).join('');
      searchResults.querySelectorAll('.search-result').forEach(el => {
        el.addEventListener('click', () => {
          revealNode(el.dataset.id);
          searchInput.value = '';
          updateSearch('');
        });
      });
    }
    searchResults.classList.add('visible');
    render();
  }

  function highlightMatch(label, q) {
    const idx = label.toLowerCase().indexOf(q);
    if (idx < 0) return escapeHtml(label);
    return escapeHtml(label.slice(0, idx)) +
      '<mark style="background:#fbe7c2;padding:0 2px;border-radius:2px">' +
      escapeHtml(label.slice(idx, idx + q.length)) +
      '</mark>' +
      escapeHtml(label.slice(idx + q.length));
  }

  function revealNode(id) {
    const node = findNode(id);
    if (!node) return;
    if (!isInCurrentView(id)) goToView('root');
    ancestorIds(id).forEach(aid => state.expanded.add(aid));
    state.expanded.add('root');
    state.selected = id;
    state.searchMatches.clear();
    state.searchMatches.add(id);
    setTimeout(() => { state.searchMatches.delete(id); render(); }, 1800);
    openSidebar(node);
    render();
    centreOnNode(id);
  }

  function isInCurrentView(id) {
    const root = getViewRootNode();
    return !!findNode(id, root);
  }

  function centreOnNode(id) {
    render();
    const p = screenPos.get(id);
    if (!p) return;
    const targetX = canvasWrap.clientWidth / 2 - 100;
    const targetY = canvasWrap.clientHeight / 2;
    state.pan.x += (targetX - p.x);
    state.pan.y += (targetY - p.y);
    render();
  }

  function handleNodeClick(id) {
    const node = findNode(id);
    if (!node) return;
    const isViewRoot = id === state.viewRoot;
    const hasChildren = node.children && node.children.length > 0;

    if (isViewRoot) {
      state.selected = id;
      openSidebar(node);
      render();
      return;
    }

    if (state.selected === id) {
      if (node.type === 'root') toggleExpand(id);
      else openSidebar(node);
    } else {
      state.selected = id;
      if (hasChildren) toggleExpand(id, true);
      else openSidebar(node);
    }
    render();
  }

  function toggleExpand(id, forceOpen = false) {
    if (forceOpen) { state.expanded.add(id); return; }
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
  }

  // ---- Sidebar ----

  function openSidebar(node) {
    const color = nodeColor(node);
    const typeLabel = node.type === 'project' ? 'Project' : (node.type === 'task' ? 'Task' : 'Root');
    const isViewRoot = node.id === state.viewRoot;
    const canOpenAsMindmap = !isViewRoot && node.children && node.children.length > 0 && node.type !== 'root';

    let colourHTML = '';
    if (node.type !== 'root') {
      const swatches = NODE_COLORS.map(c =>
        `<button class="color-swatch${node.color === c.value ? ' active' : ''}" style="background:${c.value}" data-color="${c.value}" title="${c.label}"></button>`
      ).join('');
      colourHTML = `
        <div class="sidebar-section">
          <div class="sidebar-label">Node colour</div>
          <div class="color-swatches">
            <button class="color-swatch color-swatch-clear${!node.color ? ' active' : ''}" data-color="" title="Clear (use status colour)">×</button>
            ${swatches}
          </div>
        </div>
      `;
    }

    let metaHTML = '';
    if (node.type === 'project') {
      metaHTML = `
        <div class="sidebar-section">
          <div class="meta-grid">
            <div>
              <div class="sidebar-label">Due</div>
              <div class="sidebar-value">${escapeHtml(node.due || '—')}</div>
            </div>
            <div>
              <div class="sidebar-label">Priority</div>
              <div class="sidebar-value">${escapeHtml(node.priority || '—')}</div>
            </div>
          </div>
        </div>
      `;
    }

    // Tags section
    let tagsHTML = '';
    if (node.type !== 'root') {
      const chips = (node.tags || []).map(t => {
        const c = tagColor(t);
        return `<span class="tag-chip tag-chip-removable" style="background:${c.bg};color:${c.fg}">
          ${escapeHtml(t)}
          <span class="tag-x" data-untag="${escapeHtml(t)}">×</span>
        </span>`;
      }).join('');
      const empty = (!node.tags || node.tags.length === 0) ? '<span class="tag-empty">No tags yet</span>' : '';
      tagsHTML = `
        <div class="sidebar-section">
          <div class="sidebar-label">
            <span>Tags</span>
            <span class="sidebar-label-hint">click × to remove</span>
          </div>
          <div class="tags-row">
            ${chips}
            ${empty}
            <div class="tag-suggest">
              <button class="tag-add-btn" id="tag-add-btn">+ Add tag</button>
              <div class="tag-suggest-panel" id="tag-suggest-panel">
                <input class="tag-suggest-input" id="tag-suggest-input" type="text" placeholder="Type a tag…" autocomplete="off">
                <div id="tag-suggest-list"></div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // Folder paths section
    let pathsHTML = '';
    if (node.type !== 'root') {
      const paths = node.paths || [];
      const editing = state.editingPath && state.editingPath.nodeId === node.id ? state.editingPath : null;
      const items = paths.map((p, idx) => {
        if (editing && editing.idx === idx) {
          return `
            <div class="path-edit" data-edit-idx="${idx}">
              <input type="text" class="path-edit-label" placeholder="Label (optional, e.g. 'Source repo')" value="${escapeHtml(p.label || '')}">
              <input type="text" class="path-input path-edit-path" placeholder="/path/to/folder" value="${escapeHtml(p.path || '')}">
              <div class="path-edit-actions">
                <button class="path-edit-cancel" data-cancel="${idx}">Cancel</button>
                <button class="path-edit-save" data-save="${idx}">Save</button>
              </div>
            </div>
          `;
        }
        return `
          <li class="path-item" data-path-idx="${idx}">
            <div class="path-icon">📁</div>
            <div class="path-content">
              <div class="path-label ${p.label ? '' : 'muted'}">${escapeHtml(p.label || 'Untitled path')}</div>
              <div class="path-string" title="${escapeHtml(p.path || '')}">${escapeHtml(p.path || '')}</div>
            </div>
            <div class="path-actions">
              <button class="path-action-btn" data-copy-idx="${idx}" title="Copy path">⎘</button>
              <button class="path-action-btn" data-edit-path-idx="${idx}" title="Edit">✎</button>
              <button class="path-action-btn delete" data-delete-path-idx="${idx}" title="Delete">×</button>
            </div>
          </li>
        `;
      }).join('');

      const newRow = (editing && editing.idx === -1) ? `
        <div class="path-edit" data-edit-idx="-1">
          <input type="text" class="path-edit-label" placeholder="Label (optional, e.g. 'Source repo')" value="">
          <input type="text" class="path-input path-edit-path" placeholder="/path/to/folder" value="" autofocus>
          <div class="path-edit-actions">
            <button class="path-edit-cancel" data-cancel="-1">Cancel</button>
            <button class="path-edit-save" data-save="-1">Save</button>
          </div>
        </div>
      ` : '';

      const empty = paths.length === 0 && !newRow ? '<div class="paths-empty">No folder paths yet.</div>' : '';
      const addBtn = (!editing || editing.idx !== -1) ? '<button class="path-add-btn" id="path-add-btn">+ Add folder path</button>' : '';

      pathsHTML = `
        <div class="sidebar-section">
          <div class="sidebar-label">
            <span>Folder paths${paths.length > 0 ? ` (${paths.length})` : ''}</span>
            <span class="sidebar-label-hint">where the files live</span>
          </div>
          ${empty}
          ${items ? `<ul class="paths-list">${items}</ul>` : ''}
          ${newRow}
          ${addBtn}
        </div>
      `;
    }

    let progressHTML = '';
    if (typeof node.progress === 'number' && !isViewRoot) {
      progressHTML = `
        <div class="sidebar-section">
          <div class="sidebar-label">Progress</div>
          <div class="sidebar-value">${node.progress}%</div>
          <div class="progress-bar"><div class="progress-fill" style="width:${node.progress}%;background:${color}"></div></div>
        </div>
      `;
    }

    let notesHTML = '';
    if (node.notes) {
      notesHTML = `
        <div class="sidebar-section">
          <div class="sidebar-label">Notes</div>
          <div class="notes">${escapeHtml(node.notes)}</div>
        </div>
      `;
    }

    let tasksHTML = '';
    if (node.children && node.children.length > 0) {
      tasksHTML = `
        <div class="sidebar-section">
          <div class="sidebar-label">Sub-items (${node.children.length})</div>
          <ul class="tasks-list">
            ${node.children.map(c => `
              <li class="${c.done ? 'done' : ''}" data-id="${c.id}">
                <span class="check ${c.done ? 'checked' : ''}">${c.done ? '✓' : ''}</span>
                <span class="task-label">${escapeHtml(c.label)}</span>
                <button class="task-remove" data-remove="${c.id}" title="Remove">×</button>
              </li>
            `).join('')}
          </ul>
        </div>
      `;
    }

    const linked = getLinkedNodes(node.id);
    let linksHTML = '';
    if (node.type !== 'root') {
      linksHTML = `
        <div class="sidebar-section">
          <div class="sidebar-label">
            <span>Linked nodes (${linked.length})</span>
            <span class="sidebar-label-hint">drag a node's ↗ here to link</span>
          </div>
          ${linked.length === 0
            ? '<div class="links-empty">No links yet. Drag the ↗ handle from any node onto this panel.</div>'
            : `<ul class="links-list">
                ${linked.map(l => {
                  const lc = nodeColor(l);
                  const initial = l.label.charAt(0).toUpperCase();
                  const tagStr = (l.tags || []).slice(0, 2).join(', ') || (l.type === 'project' ? 'Project' : 'Task');
                  return `<li data-link-id="${l.id}">
                    <span class="link-icon" style="background:${lc}">${initial}</span>
                    <div class="link-label">${escapeHtml(l.label)}<div class="link-meta">${escapeHtml(tagStr)}</div></div>
                    <button class="task-remove" data-unlink="${l.id}" title="Unlink">×</button>
                  </li>`;
                }).join('')}
              </ul>`}
        </div>
      `;
    }

    const openMindmapHTML = canOpenAsMindmap
      ? `<button class="open-mindmap-btn" data-open-mindmap="${node.id}">Open as mindmap</button>`
      : '';

    const canDelete = node.type !== 'root' && !isViewRoot;
    const actionsHTML = `
      <div class="sb-actions">
        <button class="sb-add" data-add-here="${node.id}">+ Add sub-item</button>
        ${canDelete ? `<button class="sb-delete" data-delete-here="${node.id}">Delete</button>` : ''}
      </div>
      ${openMindmapHTML}
    `;

    sidebarContent.innerHTML = `
      <span class="type-tag" style="background:${color}22;color:${color}">${typeLabel}${isViewRoot ? ' · current view' : ''}</span>
      <h2>${escapeHtml(node.label)}</h2>
      <div class="sidebar-section first">
        <div class="sidebar-label">Status</div>
        <span class="status-pill" style="background:${color}22;color:${color}">${STATUS_LABELS[node.status] || '—'}</span>
      </div>
      ${colourHTML}
      ${metaHTML}
      ${tagsHTML}
      ${pathsHTML}
      ${progressHTML}
      ${notesHTML}
      ${tasksHTML}
      ${linksHTML}
      ${actionsHTML}
    `;

    sidebar.classList.add('open');

    setupTagPicker(node);
    setupColorPicker(node);
    setupPathHandlers(node);

    sidebarContent.querySelectorAll('[data-untag]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const tag = el.dataset.untag;
        node.tags = (node.tags || []).filter(t => t !== tag);
        api('DELETE', `/api/nodes/${node.id}/tags/${encodeURIComponent(tag)}`);
        openSidebar(node);
        render();
      });
    });

    sidebarContent.querySelectorAll('.tasks-list li').forEach(li => {
      li.addEventListener('click', (e) => {
        if (e.target.closest('.task-remove')) return;
        const childId = li.dataset.id;
        const childNode = findNode(childId);
        if (childNode) {
          state.selected = childId;
          state.expanded.add(node.id);
          openSidebar(childNode);
          render();
        }
      });
    });
    sidebarContent.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openRemoveModal(btn.dataset.remove, node.id);
      });
    });

    sidebarContent.querySelectorAll('.links-list li').forEach(li => {
      li.addEventListener('click', (e) => {
        if (e.target.closest('[data-unlink]')) return;
        revealNode(li.dataset.linkId);
      });
    });
    sidebarContent.querySelectorAll('[data-unlink]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeLink(node.id, btn.dataset.unlink);
      });
    });

    const addBtn = sidebarContent.querySelector('[data-add-here]');
    if (addBtn) addBtn.addEventListener('click', () => openAddModal(node.id));
    const delBtn = sidebarContent.querySelector('[data-delete-here]');
    if (delBtn) delBtn.addEventListener('click', () => openRemoveModal(node.id));

    const openMmBtn = sidebarContent.querySelector('[data-open-mindmap]');
    if (openMmBtn) openMmBtn.addEventListener('click', () => pushView(openMmBtn.dataset.openMindmap));
  }

  // ---- Path handlers ----

  function setupPathHandlers(node) {
    // Edit
    sidebarContent.querySelectorAll('[data-edit-path-idx]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.editPathIdx, 10);
        state.editingPath = { nodeId: node.id, idx };
        openSidebar(node);
        // Focus the path input
        setTimeout(() => {
          const input = sidebarContent.querySelector(`[data-edit-idx="${idx}"] .path-edit-path`);
          if (input) { input.focus(); input.select(); }
        }, 30);
      });
    });

    // Delete
    sidebarContent.querySelectorAll('[data-delete-path-idx]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.deletePathIdx, 10);
        confirmDeletePath(node, idx);
      });
    });

    // Copy
    sidebarContent.querySelectorAll('[data-copy-idx]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.copyIdx, 10);
        const p = (node.paths || [])[idx];
        if (!p || !p.path) return;
        try {
          await navigator.clipboard.writeText(p.path);
          showToast(`Copied: ${p.path}`);
        } catch {
          showToast('Couldn\'t access clipboard');
        }
      });
    });

    // Add new
    const addBtn = sidebarContent.querySelector('#path-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        state.editingPath = { nodeId: node.id, idx: -1 };
        openSidebar(node);
        setTimeout(() => {
          const input = sidebarContent.querySelector('[data-edit-idx="-1"] .path-edit-path');
          if (input) input.focus();
        }, 30);
      });
    }

    // Save / cancel
    sidebarContent.querySelectorAll('[data-save]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.save, 10);
        savePath(node, idx);
      });
    });
    sidebarContent.querySelectorAll('[data-cancel]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.editingPath = null;
        openSidebar(node);
      });
    });

    // Enter to save / Escape to cancel inside the edit row
    sidebarContent.querySelectorAll('.path-edit input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const row = input.closest('.path-edit');
          const idx = parseInt(row.dataset.editIdx, 10);
          savePath(node, idx);
        } else if (e.key === 'Escape') {
          state.editingPath = null;
          openSidebar(node);
        }
      });
    });
  }

  function savePath(node, idx) {
    const row = sidebarContent.querySelector(`[data-edit-idx="${idx}"]`);
    if (!row) return;
    const labelInput = row.querySelector('.path-edit-label');
    const pathInput = row.querySelector('.path-edit-path');
    const label = (labelInput.value || '').trim();
    const path = (pathInput.value || '').trim();
    if (!path) {
      pathInput.style.borderColor = '#c96342';
      pathInput.focus();
      showToast('Path can\'t be empty');
      return;
    }
    if (!node.paths) node.paths = [];
    if (idx === -1) {
      node.paths.push({ label, path });
      const newIdx = node.paths.length - 1;
      api('POST', `/api/nodes/${node.id}/paths`, { label, path })
        .then(created => { node.paths[newIdx].id = created.id; });
    } else {
      const existingId = node.paths[idx].id;
      node.paths[idx] = { ...node.paths[idx], label, path };
      if (existingId !== undefined) {
        api('PATCH', `/api/nodes/${node.id}/paths/${existingId}`, { label, path });
      }
    }
    state.editingPath = null;
    openSidebar(node);
    render();
    showToast(idx === -1 ? 'Path added' : 'Path updated');
  }

  function confirmDeletePath(node, idx) {
    const p = (node.paths || [])[idx];
    if (!p) return;
    const html = `
      <h3>Remove this path?</h3>
      <p>${escapeHtml(p.label || 'Untitled path')}<br><span style="font-family:'SF Mono',monospace;font-size:12px;color:#8a8a85">${escapeHtml(p.path || '')}</span></p>
      <div class="modal-buttons">
        <button class="btn-cancel" onclick="window.__closeModal()">Cancel</button>
        <button class="btn-confirm btn-danger" onclick="window.__confirmDeletePath('${node.id}', ${idx})">Remove</button>
      </div>
    `;
    showModal(html);
  }

  window.__confirmDeletePath = function(nodeId, idx) {
    const node = findNode(nodeId);
    if (!node || !node.paths) { closeModal(); return; }
    const pid = node.paths[idx] && node.paths[idx].id;
    node.paths.splice(idx, 1);
    if (pid !== undefined) api('DELETE', `/api/nodes/${node.id}/paths/${pid}`);
    closeModal();
    openSidebar(node);
    render();
  };

  // ---- Tag picker ----

  function setupTagPicker(node) {
    const btn = sidebarContent.querySelector('#tag-add-btn');
    const panel = sidebarContent.querySelector('#tag-suggest-panel');
    const input = sidebarContent.querySelector('#tag-suggest-input');
    const list = sidebarContent.querySelector('#tag-suggest-list');
    if (!btn || !panel) return;

    const refreshList = (q) => {
      const query = (q || '').trim().toLowerCase();
      const used = new Set(node.tags || []);
      const counts = new Map();
      (function walk(n) {
        (n.tags || []).forEach(t => counts.set(t, (counts.get(t) || 0) + 1));
        if (n.children) n.children.forEach(walk);
      })(data);
      const candidates = allTags
        .filter(t => !used.has(t))
        .filter(t => !query || t.toLowerCase().includes(query))
        .sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0))
        .slice(0, 12);
      const items = candidates.map(t => {
        const c = counts.get(t) || 0;
        const tc = tagColor(t);
        return `<div class="tag-suggest-item" data-tag="${escapeHtml(t)}">
          <span><span class="tag-chip" style="background:${tc.bg};color:${tc.fg}">${escapeHtml(t)}</span></span>
          <span class="tag-suggest-meta">${c} use${c === 1 ? '' : 's'}</span>
        </div>`;
      }).join('');
      const exactExists = allTags.some(t => t.toLowerCase() === query);
      const createRow = (query && !exactExists)
        ? `<div class="tag-suggest-item create" data-create="${escapeHtml(query)}">+ Create "${escapeHtml(query)}"</div>`
        : '';
      list.innerHTML = items + createRow || '<div class="tag-suggest-meta" style="padding:6px 9px">No tags to add</div>';
      list.querySelectorAll('[data-tag]').forEach(el => {
        el.addEventListener('click', () => addTagToNode(node, el.dataset.tag));
      });
      list.querySelectorAll('[data-create]').forEach(el => {
        el.addEventListener('click', () => {
          const t = el.dataset.create.trim();
          if (!t) return;
          if (!allTags.some(x => x.toLowerCase() === t.toLowerCase())) allTags.push(t);
          addTagToNode(node, t);
        });
      });
    };

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const show = !panel.classList.contains('visible');
      panel.classList.toggle('visible', show);
      if (show) {
        input.value = '';
        refreshList('');
        setTimeout(() => input.focus(), 30);
      }
    });

    input.addEventListener('input', (e) => refreshList(e.target.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = list.querySelector('[data-tag], [data-create]');
        if (first) first.click();
      } else if (e.key === 'Escape') panel.classList.remove('visible');
    });

    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target) && e.target !== btn) panel.classList.remove('visible');
    }, { once: true });
  }

  function setupColorPicker(node) {
    sidebarContent.querySelectorAll('.color-swatch').forEach(btn => {
      btn.addEventListener('click', () => {
        const color = btn.dataset.color || null;
        node.color = color;
        api('PATCH', `/api/nodes/${node.id}`, { color });
        openSidebar(node);
        render();
      });
    });
  }

  function addTagToNode(node, tag) {
    if (!node.tags) node.tags = [];
    if (!node.tags.includes(tag)) {
      node.tags.push(tag);
      api('POST', `/api/nodes/${node.id}/tags`, { name: tag });
    }
    if (!allTags.includes(tag)) allTags.push(tag);
    openSidebar(node);
    render();
  }

  // ---- Modals ----

  function showModal(html, onMounted) {
    modalContent.innerHTML = html;
    modalBackdrop.classList.add('visible');
    if (onMounted) onMounted();
    modalBackdrop.onclick = (e) => { if (e.target === modalBackdrop) closeModal(); };
    document.addEventListener('keydown', escClose);
  }
  function escClose(e) {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
      const c = modalContent.querySelector('.btn-confirm');
      if (c) c.click();
    }
  }
  function closeModal() {
    modalBackdrop.classList.remove('visible');
    modalContent.innerHTML = '';
    document.removeEventListener('keydown', escClose);
  }

  function openAddModal(parentId) {
    const parent = findNode(parentId);
    if (!parent) return;
    const childType = parent.type === 'root' ? 'project' : 'task';
    const childTypeLabel = childType === 'project' ? 'project' : 'sub-item';
    const inheritedTags = (parent.tags || []).join(', ');

    const html = `
      <h3>Add ${childTypeLabel}</h3>
      <p>Adding under <strong>${escapeHtml(parent.label)}</strong></p>
      <div class="field">
        <label>Name</label>
        <input id="new-label" type="text" placeholder="e.g. Draft introduction">
      </div>
      <div class="field">
        <label>Status</label>
        <select id="new-status">
          <option value="idea">Idea</option>
          <option value="active" selected>Active</option>
          <option value="onhold">On hold</option>
          <option value="completed">Completed</option>
        </select>
      </div>
      <div class="field">
        <label>Tags (comma separated)</label>
        <input id="new-tags" type="text" value="${escapeHtml(inheritedTags)}" placeholder="e.g. Teaching, Year 8">
      </div>
      <div class="field">
        <label>Folder path (optional)</label>
        <input id="new-path" class="path-input" type="text" placeholder="/path/to/folder">
      </div>
      <div class="field">
        <label>Notes (optional)</label>
        <textarea id="new-notes" placeholder="Anything worth remembering"></textarea>
      </div>
      <div class="modal-buttons">
        <button class="btn-cancel" onclick="window.__closeModal()">Cancel</button>
        <button class="btn-confirm" onclick="window.__confirmAdd('${parentId}','${childType}')">Add</button>
      </div>
    `;
    showModal(html, () => {
      setTimeout(() => {
        const inp = document.getElementById('new-label');
        if (inp) inp.focus();
      }, 50);
    });
  }

  function openRemoveModal(nodeId, parentForReopen) {
    const node = findNode(nodeId);
    if (!node || node.type === 'root') return;
    const descCount = countDescendants(node);
    const linkCount = links.filter(l => l.source_id === nodeId || l.target_id === nodeId).length;
    const parts = [];
    if (descCount > 0) parts.push(`${descCount} sub-item${descCount === 1 ? '' : 's'}`);
    if (linkCount > 0) parts.push(`${linkCount} link${linkCount === 1 ? '' : 's'}`);
    const extra = parts.length ? ` This will also remove ${parts.join(' and ')}.` : '';
    const reopenAttr = parentForReopen ? `'${parentForReopen}'` : 'null';

    const html = `
      <h3>Remove "${escapeHtml(node.label)}"?</h3>
      <p>This action can't be undone in the prototype.${extra}</p>
      <div class="modal-buttons">
        <button class="btn-cancel" onclick="window.__closeModal()">Cancel</button>
        <button class="btn-confirm btn-danger" onclick="window.__confirmRemove('${nodeId}', ${reopenAttr})">Remove</button>
      </div>
    `;
    showModal(html);
  }

  window.__closeModal = closeModal;

  window.__confirmAdd = function(parentId, childType) {
    const labelInput = document.getElementById('new-label');
    const statusInput = document.getElementById('new-status');
    const tagsInput = document.getElementById('new-tags');
    const pathInput = document.getElementById('new-path');
    const notesInput = document.getElementById('new-notes');
    const label = (labelInput.value || '').trim();
    if (!label) { labelInput.style.borderColor = '#c96342'; labelInput.focus(); return; }
    const parent = findNode(parentId);
    if (!parent) { closeModal(); return; }
    const status = statusInput.value;
    const tags = (tagsInput.value || '').split(',').map(s => s.trim()).filter(Boolean);
    tags.forEach(t => { if (!allTags.includes(t)) allTags.push(t); });
    const pathStr = (pathInput.value || '').trim();
    const notesStr = (notesInput.value || '').trim() || undefined;
    const progress = status === 'completed' ? 100 : 0;
    const body = {
      label,
      type: childType,
      parent_id: parent.id,
      status,
      progress
    };
    if (childType === 'project') {
      body.due = '—';
      body.priority = 'Medium';
    }
    if (notesStr) body.notes = notesStr;
    closeModal();
    api('POST', '/api/nodes', body).then(newNode => {
      newNode.children = newNode.children || [];
      newNode.tags = newNode.tags || [];
      newNode.paths = newNode.paths || [];
      newNode.done = status === 'completed';
      if (!parent.children) parent.children = [];
      parent.children.push(newNode);
      state.expanded.add(parent.id);
      state.selected = newNode.id;
      // Apply tags via API
      tags.forEach(t => {
        newNode.tags.push(t);
        api('POST', `/api/nodes/${newNode.id}/tags`, { name: t });
      });
      // Apply path via API
      if (pathStr) {
        api('POST', `/api/nodes/${newNode.id}/paths`, { label: '', path: pathStr })
          .then(created => { newNode.paths.push({ id: created.id, label: '', path: pathStr }); render(); });
      }
      render();
      selectNode(newNode.id);
      if (sidebar.classList.contains('open')) openSidebar(parent);
    });
  };

  function selectNode(id) {
    state.selected = id;
    const n = findNode(id);
    if (n) openSidebar(n);
  }

  window.__confirmRemove = function(nodeId, parentForReopen) {
    closeModal();
    api('DELETE', `/api/nodes/${nodeId}`).then(() => {
      const parent = findParent(nodeId);
      if (!parent) return;
      const toRemove = new Set([nodeId]);
      const nodeToRemove = findNode(nodeId);
      if (nodeToRemove) {
        (function walk(n) {
          if (n.children) n.children.forEach(c => { toRemove.add(c.id); walk(c); });
        })(nodeToRemove);
      }
      parent.children = parent.children.filter(c => c.id !== nodeId);
      for (let i = links.length - 1; i >= 0; i--) {
        if (toRemove.has(links[i].source_id) || toRemove.has(links[i].target_id)) links.splice(i, 1);
      }
      state.viewStack = state.viewStack.filter(v => !toRemove.has(v));
      if (state.viewStack.length === 0) state.viewStack = ['root'];
      if (toRemove.has(state.viewRoot)) state.viewRoot = state.viewStack[state.viewStack.length - 1];
      toRemove.forEach(id => { state.expanded.delete(id); delete state.viewState[id]; });
      if (state.selected === nodeId) state.selected = null;
      render();
      if (parentForReopen && findNode(parentForReopen)) {
        openSidebar(findNode(parentForReopen));
        return;
      }
      if (sidebar.classList.contains('open') && !findNode(state.selected)) closeSidebar();
    });
  };

  window.closeSidebar = function() {
    sidebar.classList.remove('open');
    state.selected = null;
    state.editingPath = null;
    render();
  };

  window.expandAll = function() {
    const root = getViewRootNode();
    (function walk(n) { state.expanded.add(n.id); if (n.children) n.children.forEach(walk); })(root);
    render();
  };
  window.collapseAll = function() {
    state.expanded.clear();
    state.expanded.add(state.viewRoot);
    state.selected = null;
    sidebar.classList.remove('open');
    render();
  };
  window.resetView = function() {
    state.pan = { x: 0, y: 0 };
    state.zoom = 1;
    render();
  };
  window.zoomIn = function() { state.zoom = Math.min(2.5, state.zoom * 1.2); render(); };
  window.zoomOut = function() { state.zoom = Math.max(0.3, state.zoom / 1.2); render(); };

  let toastTimer;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
  }

  canvasWrap.addEventListener('mousedown', (e) => {
    if (e.target.closest('.node-group') || e.target.closest('.toolbar') ||
        e.target.closest('.sidebar') || e.target.closest('.legend') ||
        e.target.closest('.zoom') || e.target.closest('.modal-backdrop') ||
        e.target.closest('.breadcrumbs')) return;
    state.dragging = true;
    state.didDrag = false;
    state.dragStart = { x: e.clientX - state.pan.x, y: e.clientY - state.pan.y };
    canvasWrap.classList.add('dragging');
  });

  window.addEventListener('mousemove', (e) => {
    if (state.linking) { updateLinkDrag(e.clientX, e.clientY); return; }
    if (!state.dragging) return;
    const nx = e.clientX - state.dragStart.x;
    const ny = e.clientY - state.dragStart.y;
    if (Math.abs(nx - state.pan.x) > 2 || Math.abs(ny - state.pan.y) > 2) state.didDrag = true;
    state.pan.x = nx;
    state.pan.y = ny;
    render();
  });

  window.addEventListener('mouseup', (e) => {
    if (state.linking) { endLinkDrag(e.clientX, e.clientY); return; }
    state.dragging = false;
    canvasWrap.classList.remove('dragging');
    setTimeout(() => { state.didDrag = false; }, 50);
  });

  canvasWrap.addEventListener('wheel', (e) => {
    if (e.target.closest('.sidebar') || e.target.closest('.search-results')) return;
    e.preventDefault();
    const delta = -e.deltaY;
    const factor = delta > 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.max(0.3, Math.min(2.5, state.zoom * factor));
    if (newZoom === state.zoom) return;
    const mx = e.clientX, my = e.clientY;
    const ratio = newZoom / state.zoom;
    state.pan.x = mx - ratio * (mx - state.pan.x);
    state.pan.y = my - ratio * (my - state.pan.y);
    state.zoom = newZoom;
    render();
  }, { passive: false });

  canvasWrap.addEventListener('touchstart', (e) => {
    if (e.target.closest('.node-group')) return;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    state.dragging = true;
    state.didDrag = false;
    state.dragStart = { x: t.clientX - state.pan.x, y: t.clientY - state.pan.y };
  }, { passive: true });
  canvasWrap.addEventListener('touchmove', (e) => {
    if (!state.dragging || e.touches.length !== 1) return;
    const t = e.touches[0];
    state.pan.x = t.clientX - state.dragStart.x;
    state.pan.y = t.clientY - state.dragStart.y;
    state.didDrag = true;
    render();
  }, { passive: true });
  canvasWrap.addEventListener('touchend', () => {
    state.dragging = false;
    setTimeout(() => { state.didDrag = false; }, 50);
  });

  searchInput.addEventListener('input', (e) => updateSearch(e.target.value));
  searchInput.addEventListener('focus', (e) => { if (e.target.value) updateSearch(e.target.value); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) searchResults.classList.remove('visible');
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { searchInput.value = ''; updateSearch(''); searchInput.blur(); }
    if (e.key === 'Enter') {
      const first = searchResults.querySelector('.search-result');
      if (first) first.click();
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
    if (e.key === 'Escape' && state.viewRoot !== 'root' &&
        !searchInput.matches(':focus') &&
        !modalBackdrop.classList.contains('visible') &&
        !state.editingPath) {
      popView();
    }
  });

  setTimeout(() => hint.classList.add('visible'), 500);
  setTimeout(() => hint.classList.remove('visible'), 7500);

  async function init() {
    const json = await api('GET', '/api/tree');
    data = json.tree;
    links = json.links;
    allTags = json.tags;
    state.expanded = new Set([data.id]);
    if (data.children && data.children.length > 0) {
      state.expanded.add(data.children[0].id);
    }
    render();
  }

  init();
  window.addEventListener('resize', () => { if (data) render(); });
})();
