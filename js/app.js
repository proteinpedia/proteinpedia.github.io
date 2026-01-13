// State
let activationData = {};  // [layer][position] -> array of {value, latentIdx}
let topActivationsData = null;  // Top activations per layer/latent from JSON
let sequence = '';
let canvasNodes = [];      // {id, x, y, latentIdx, layer, pos, aa, isSuper, children}
let edges = [];            // {id, from, to}
let selectedNodes = new Set();
let selectedEdges = new Set();
let nodeIdCounter = 0;
let edgeIdCounter = 0;
let dragState = null;

// File upload state
let uploadedFiles = {
    activationIndices: null,
    seq: null,
    topActivations: null
};

// Upload screen elements
const uploadScreen = document.getElementById('upload-screen');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const btnLoad = document.getElementById('btn-load');
const statusActivation = document.getElementById('status-activation');
const statusSeq = document.getElementById('status-seq');
const statusTop = document.getElementById('status-top');
const appContainer = document.getElementById('app');

// File upload handlers
dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
});

dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-over');
});

dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
});

function handleFiles(files) {
    for (const file of files) {
        const name = file.name.toLowerCase();

        if (name === 'activation_indices.json' || name.includes('activation_indices')) {
            uploadedFiles.activationIndices = file;
            statusActivation.classList.add('loaded');
            statusActivation.querySelector('.status-icon').textContent = '●';
        } else if (name === 'seq.txt' || name.includes('seq')) {
            uploadedFiles.seq = file;
            statusSeq.classList.add('loaded');
            statusSeq.querySelector('.status-icon').textContent = '●';
        } else if (name === 'top_activations.json' || name.includes('top_activations')) {
            uploadedFiles.topActivations = file;
            statusTop.classList.add('loaded');
            statusTop.querySelector('.status-icon').textContent = '●';
        }
    }

    updateLoadButton();
}

function updateLoadButton() {
    const allLoaded = uploadedFiles.activationIndices &&
                      uploadedFiles.seq &&
                      uploadedFiles.topActivations;
    btnLoad.disabled = !allLoaded;
}

btnLoad.addEventListener('click', async () => {
    if (btnLoad.disabled) return;

    try {
        btnLoad.textContent = 'Loading...';
        btnLoad.disabled = true;

        // Read all files
        const [activationsText, seqText, topActivationsText] = await Promise.all([
            uploadedFiles.activationIndices.text(),
            uploadedFiles.seq.text(),
            uploadedFiles.topActivations.text()
        ]);

        const activations = JSON.parse(activationsText);
        sequence = seqText.trim();
        topActivationsData = JSON.parse(topActivationsText);

        // Index by layer and position
        for (const [layer, pos, value, latentIdx] of activations) {
            if (!activationData[layer]) activationData[layer] = {};
            if (!activationData[layer][pos]) activationData[layer][pos] = [];
            activationData[layer][pos].push({ value, latentIdx });
        }

        // Hide upload screen, show app
        uploadScreen.classList.add('hidden');
        appContainer.classList.remove('hidden');

        // Render the visualization
        renderGrid();
        renderSequence();
        updateLegend();

    } catch (err) {
        console.error('Error loading files:', err);
        alert('Error loading files. Please make sure all files are valid.');
        btnLoad.textContent = 'Load Data';
        updateLoadButton();
    }
});

// DOM Elements
const gridBody = document.getElementById('grid-body');
const sequenceBar = document.getElementById('sequence-bar');
const sequenceContent = document.getElementById('sequence-content');
const nodesContainer = document.getElementById('nodes-container');
const edgesSvg = document.getElementById('edges-svg');
const btnConnect = document.getElementById('btn-connect');
const btnCombine = document.getElementById('btn-combine');
const btnDelete = document.getElementById('btn-delete');
const activationPanel = document.getElementById('activation-panel');
const panelTitle = document.getElementById('panel-title');
const panelContent = document.getElementById('activation-panel-content');
const panelClose = document.getElementById('panel-close');

// Sync scroll between grid and sequence bar
let isSyncing = false;
gridBody.addEventListener('scroll', () => {
    if (isSyncing) return;
    isSyncing = true;
    sequenceBar.scrollLeft = gridBody.scrollLeft;
    isSyncing = false;
});
sequenceBar.addEventListener('scroll', () => {
    if (isSyncing) return;
    isSyncing = true;
    gridBody.scrollLeft = sequenceBar.scrollLeft;
    isSyncing = false;
});

// Color scale for activation values (blue -> cyan -> green -> yellow -> red heatmap)
function getActivationColor(value, minVal, maxVal) {
    const t = Math.max(0, Math.min(1, (value - minVal) / (maxVal - minVal)));

    // 5-stop heatmap: blue (0) -> cyan (0.25) -> green (0.5) -> yellow (0.75) -> red (1)
    let r, g, b;
    if (t < 0.25) {
        // Blue to Cyan
        const s = t / 0.25;
        r = 0;
        g = Math.round(255 * s);
        b = 255;
    } else if (t < 0.5) {
        // Cyan to Green
        const s = (t - 0.25) / 0.25;
        r = 0;
        g = 255;
        b = Math.round(255 * (1 - s));
    } else if (t < 0.75) {
        // Green to Yellow
        const s = (t - 0.5) / 0.25;
        r = Math.round(255 * s);
        g = 255;
        b = 0;
    } else {
        // Yellow to Red
        const s = (t - 0.75) / 0.25;
        r = 255;
        g = Math.round(255 * (1 - s));
        b = 0;
    }
    return `rgb(${r}, ${g}, ${b})`;
}


// Find min/max activation values for color scaling
function getValueRange() {
    let min = Infinity, max = -Infinity;
    for (const layer in activationData) {
        for (const pos in activationData[layer]) {
            for (const item of activationData[layer][pos]) {
                min = Math.min(min, item.value);
                max = Math.max(max, item.value);
            }
        }
    }
    return { min, max };
}

// Update legend with actual min/max values
function updateLegend() {
    const { min, max } = getValueRange();
    const legendMin = document.querySelector('.legend-min');
    const legendMax = document.querySelector('.legend-max');
    if (legendMin) legendMin.textContent = min.toFixed(2);
    if (legendMax) legendMax.textContent = max.toFixed(2);
}

// Render grid - layers as rows, positions as columns
function renderGrid() {
    const { min, max } = getValueRange();
    const numPositions = sequence.length;

    let html = '';
    // Each row is a layer (reversed: 5 to 0)
    for (let layer = 5; layer >= 0; layer--) {
        html += `<div class="grid-row" data-layer="${layer}">`;
        // Each column is a position
        for (let pos = 0; pos < numPositions; pos++) {
            html += `<div class="grid-cell" data-layer="${layer}" data-pos="${pos}">`;
            const items = activationData[layer]?.[pos] || [];
            for (const item of items) {
                const color = getActivationColor(item.value, min, max);
                const t = (item.value - min) / (max - min);
                // Use black text for bright colors (cyan, green, yellow), white for dark (blue, red)
                const textColor = (t > 0.15 && t < 0.85) ? '#000' : '#fff';
                html += `<div class="latent-box"
                    data-layer="${layer}"
                    data-pos="${pos}"
                    data-latent="${item.latentIdx}"
                    data-value="${item.value.toFixed(2)}"
                    style="background: ${color}; color: ${textColor}"
                    title="L${item.latentIdx} (${item.value.toFixed(2)})"
                >${item.latentIdx}</div>`;
            }
            html += '</div>';
        }
        html += '</div>';
    }
    gridBody.innerHTML = html;

    // Add click handlers
    gridBody.querySelectorAll('.latent-box').forEach(box => {
        box.addEventListener('click', handleLatentClick);
    });
}

// Render sequence bar
function renderSequence() {
    let html = '';
    for (let i = 0; i < sequence.length; i++) {
        html += `<div class="seq-item" data-pos="${i}">
            <span class="seq-aa">${sequence[i]}</span>
            <span class="seq-pos">${i}</span>
        </div>`;
    }
    sequenceContent.innerHTML = html;

    // Add click handlers to scroll grid horizontally
    sequenceContent.querySelectorAll('.seq-item').forEach(item => {
        item.addEventListener('click', () => {
            const pos = parseInt(item.dataset.pos);
            const cell = gridBody.querySelector(`.grid-cell[data-pos="${pos}"]`);
            if (cell) {
                cell.scrollIntoView({ behavior: 'smooth', inline: 'center' });
                // Highlight column briefly
                const cells = gridBody.querySelectorAll(`.grid-cell[data-pos="${pos}"]`);
                cells.forEach(c => c.style.background = 'rgba(0, 217, 255, 0.2)');
                setTimeout(() => cells.forEach(c => c.style.background = ''), 500);
            }
        });
    });
}

// Handle latent click - show activation panel
function handleLatentClick(e) {
    const layer = parseInt(e.target.dataset.layer);
    const pos = parseInt(e.target.dataset.pos);
    const latentIdx = parseInt(e.target.dataset.latent);
    const value = parseFloat(e.target.dataset.value);
    const aa = sequence[pos];

    // Show activation panel with wild type sequence and clicked position
    showActivationPanel(layer, latentIdx, pos, value);

    // Also add to canvas (original behavior)
    addNodeToCanvas(latentIdx, layer, pos, aa, value);
}

// Get activations for a specific latent across all positions in the wild type sequence
function getWildTypeActivations(layer, latentIdx) {
    const activations = new Array(sequence.length).fill(0);
    const layerData = activationData[layer];
    if (!layerData) return activations;

    for (const pos in layerData) {
        const items = layerData[pos];
        for (const item of items) {
            if (item.latentIdx === latentIdx) {
                activations[parseInt(pos)] = item.value;
            }
        }
    }
    return activations;
}

// Render wild type sequence with activations
function renderWildTypeCard(layer, latentIdx, clickedPos, clickedValue) {
    const activations = getWildTypeActivations(layer, latentIdx);
    const maxActivation = Math.max(...activations.filter(a => a > 0));

    // Build amino acid visualization
    let aaHtml = '';
    for (let i = 0; i < sequence.length; i++) {
        const aa = sequence[i];
        const activation = activations[i] || 0;
        const isClicked = i === clickedPos;

        if (activation === 0) {
            aaHtml += `<span class="aa-char zero${isClicked ? ' clicked' : ''}" data-pos="${i}" data-aa="${aa}" data-activation="0.00">${aa}</span>`;
        } else {
            const color = getActivationColorForPanel(activation, 0, maxActivation);
            const textColor = activation > maxActivation * 0.5 ? '#000' : '#fff';
            aaHtml += `<span class="aa-char${isClicked ? ' clicked' : ''}" data-pos="${i}" data-aa="${aa}" data-activation="${activation.toFixed(2)}" style="background: ${color}; color: ${textColor}">${aa}</span>`;
        }
    }

    return `
        <div class="seq-card wild-type-card">
            <div class="seq-card-header">
                <div class="seq-card-title">
                    <h3><span class="wild-type-badge">Wild Type</span>Sequence</h3>
                </div>
            </div>
            <div class="clicked-position-info">
                <div class="clicked-label">Current Position</div>
                <div class="clicked-details">
                    <span class="clicked-pos">Position ${clickedPos}</span>
                    <span class="clicked-aa">${sequence[clickedPos]}</span>
                    <span class="clicked-activation">Activation: ${clickedValue.toFixed(3)}</span>
                </div>
            </div>
            <div class="seq-visualization">
                <div class="seq-amino-acids">${aaHtml}</div>
            </div>
        </div>
    `;
}

// Current panel state for tab switching
let currentPanelState = null;

// Show the activation panel with wild type and top sequences for a latent
function showActivationPanel(layer, latentIdx, clickedPos, clickedValue) {
    // Store state for tab switching
    currentPanelState = { layer, latentIdx, clickedPos, clickedValue };

    // Update panel title
    panelTitle.textContent = `Layer ${layer} - Latent ${latentIdx}`;

    // Render tabs and sequences view by default
    renderSequencesTab();

    // Show panel
    activationPanel.classList.remove('hidden');
}

// Render the Sequences tab content
function renderSequencesTab() {
    const { layer, latentIdx, clickedPos, clickedValue } = currentPanelState;

    // Add tabs
    let html = renderTabs('sequences');

    // Start with wild type card
    html += renderWildTypeCard(layer, latentIdx, clickedPos, clickedValue);

    // Add separator
    html += '<div class="panel-section-title">Top Activating Sequences</div>';

    // Add top sequences if available
    if (topActivationsData && topActivationsData.layers) {
        const layerData = topActivationsData.layers[layer.toString()];
        if (layerData) {
            const latentData = layerData[latentIdx.toString()];
            if (latentData && latentData.length > 0) {
                latentData.forEach((item, idx) => {
                    html += renderSequenceCard(item, idx + 1);
                });
            } else {
                html += '<div class="no-data-message">No top sequences available for this latent.</div>';
            }
        } else {
            html += '<div class="no-data-message">No data available for this layer.</div>';
        }
    } else {
        html += '<div class="no-data-message">Top activations data not loaded.</div>';
    }

    panelContent.innerHTML = html;
    attachTabListeners();
}

// Render tab controls
function renderTabs(activeTab) {
    return `
        <div class="panel-tabs">
            <button class="panel-tab ${activeTab === 'sequences' ? 'active' : ''}" data-tab="sequences">Sequences</button>
            <button class="panel-tab ${activeTab === 'alignment' ? 'active' : ''}" data-tab="alignment">Alignment</button>
        </div>
    `;
}

// Attach tab click listeners
function attachTabListeners() {
    panelContent.querySelectorAll('.panel-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            if (tabName === 'sequences') {
                renderSequencesTab();
            } else if (tabName === 'alignment') {
                renderAlignmentTab();
            }
        });
    });
}

// Render the Alignment tab content
function renderAlignmentTab() {
    const { layer, latentIdx, clickedPos, clickedValue } = currentPanelState;

    // Add tabs
    let html = renderTabs('alignment');

    // Get all sequences to align
    const sequencesToAlign = [];

    // Add wild type sequence
    const wildTypeActivations = getWildTypeActivations(layer, latentIdx);
    const wildTypeMaxIdx = findMaxActivationIndex(wildTypeActivations);
    sequencesToAlign.push({
        name: 'Wild Type',
        entry: '',
        proteinName: 'Current Sequence',
        sequence: sequence,
        activations: wildTypeActivations,
        maxIdx: wildTypeMaxIdx,
        isWildType: true
    });

    // Add top activating sequences
    if (topActivationsData && topActivationsData.layers) {
        const layerData = topActivationsData.layers[layer.toString()];
        if (layerData) {
            const latentData = layerData[latentIdx.toString()];
            if (latentData && latentData.length > 0) {
                latentData.forEach((item, idx) => {
                    const maxIdx = findMaxActivationIndex(item.Activations);
                    sequencesToAlign.push({
                        name: item['Entry Name'] || 'Unknown',
                        entry: item.Entry || 'N/A',
                        proteinName: item['Protein names'] || 'Unknown protein',
                        sequence: item.Sequence,
                        activations: item.Activations,
                        maxIdx: maxIdx,
                        isWildType: false,
                        rank: idx + 1
                    });
                });
            }
        }
    }

    // Compute alignment
    const aligned = computeMaxAlignment(sequencesToAlign);

    // Add toolbar with Go to Center button
    html += '<div class="alignment-toolbar">';
    html += `<button class="btn-go-to-center" data-center="${aligned.alignmentPosition}">Go to Center</button>`;
    html += `<span class="alignment-info">Aligned at position ${aligned.alignmentPosition}</span>`;
    html += '</div>';

    // Render alignment view
    html += '<div class="alignment-container">';
    html += `<div class="alignment-scroll" id="alignment-scroll">`;

    // Render position ruler with center marker
    html += renderPositionRuler(aligned.totalLength, aligned.alignmentPosition);

    // Render each aligned sequence with center line
    aligned.sequences.forEach(seq => {
        html += renderAlignedSequence(seq, aligned.alignmentPosition);
    });

    html += '</div></div>';

    panelContent.innerHTML = html;
    attachTabListeners();
    attachAlignmentListeners();
}

// Attach alignment-specific listeners
function attachAlignmentListeners() {
    const goToCenterBtn = panelContent.querySelector('.btn-go-to-center');
    if (goToCenterBtn) {
        goToCenterBtn.addEventListener('click', () => {
            scrollToAlignmentCenter();
        });
    }
}

// Scroll to the alignment center
function scrollToAlignmentCenter() {
    const scrollContainer = document.getElementById('alignment-scroll');
    const centerMarker = scrollContainer?.querySelector('.center-line');
    if (scrollContainer && centerMarker) {
        const containerWidth = scrollContainer.clientWidth;
        const markerOffset = centerMarker.offsetLeft;
        // Scroll so the center line is in the middle of the view
        scrollContainer.scrollLeft = markerOffset - (containerWidth / 2) + 10;
    }
}

// Find the index of max activation in an array
function findMaxActivationIndex(activations) {
    let maxVal = -Infinity;
    let maxIdx = 0;
    for (let i = 0; i < activations.length; i++) {
        if (activations[i] > maxVal) {
            maxVal = activations[i];
            maxIdx = i;
        }
    }
    return maxIdx;
}

// Compute max activation alignment
function computeMaxAlignment(sequences) {
    // Find the maximum offset needed (the largest maxIdx)
    const maxOffset = Math.max(...sequences.map(s => s.maxIdx));

    // Calculate aligned sequences
    const alignedSequences = sequences.map(seq => {
        const leftPadding = maxOffset - seq.maxIdx;
        const alignedLength = leftPadding + seq.sequence.length;

        return {
            ...seq,
            leftPadding,
            alignedLength
        };
    });

    // Find total length (max of all aligned lengths)
    const totalLength = Math.max(...alignedSequences.map(s => s.alignedLength));

    // Add right padding info
    alignedSequences.forEach(seq => {
        seq.rightPadding = totalLength - seq.alignedLength;
    });

    return {
        sequences: alignedSequences,
        totalLength,
        alignmentPosition: maxOffset
    };
}

// Render position ruler for alignment
function renderPositionRuler(totalLength, centerPosition) {
    let html = '<div class="alignment-row ruler-row"><div class="alignment-label"></div><div class="alignment-sequence">';

    for (let i = 0; i < totalLength; i++) {
        const isCenter = i === centerPosition;
        const centerClass = isCenter ? ' center-line' : '';

        if (i % 10 === 0) {
            html += `<span class="ruler-mark${centerClass}">${i}</span>`;
        } else if (i % 5 === 0) {
            html += `<span class="ruler-tick${centerClass}">|</span>`;
        } else {
            html += `<span class="ruler-dot${centerClass}">·</span>`;
        }
    }

    html += '</div></div>';
    return html;
}

// Render a single aligned sequence
function renderAlignedSequence(seq, centerPosition) {
    const maxActivation = Math.max(...seq.activations.filter(a => a > 0));

    let html = `<div class="alignment-row ${seq.isWildType ? 'wild-type-row' : ''}">`;

    // Label
    html += '<div class="alignment-label">';
    if (seq.isWildType) {
        html += '<span class="wild-type-badge">WT</span>';
    } else {
        html += `<span class="rank-badge">#${seq.rank}</span>`;
    }
    html += `<span class="alignment-entry">${seq.entry}${seq.entry ? ' ' : ''}(${seq.name})</span>`;
    html += '</div>';

    // Sequence with padding
    html += '<div class="alignment-sequence">';

    // Track aligned position (for center line)
    let alignedPos = 0;

    // Left padding
    for (let i = 0; i < seq.leftPadding; i++) {
        const isCenter = alignedPos === centerPosition;
        html += `<span class="aa-char gap${isCenter ? ' center-line' : ''}">-</span>`;
        alignedPos++;
    }

    // Actual sequence
    for (let i = 0; i < seq.sequence.length; i++) {
        const aa = seq.sequence[i];
        const activation = seq.activations[i] || 0;
        const isMax = i === seq.maxIdx;
        const isCenter = alignedPos === centerPosition;
        const centerClass = isCenter ? ' center-line' : '';

        if (activation === 0) {
            html += `<span class="aa-char zero ${isMax ? 'max-pos' : ''}${centerClass}" data-pos="${i}" data-aa="${aa}" data-activation="0.00">${aa}</span>`;
        } else {
            const color = getActivationColorForPanel(activation, 0, maxActivation);
            const textColor = activation > maxActivation * 0.5 ? '#000' : '#fff';
            html += `<span class="aa-char ${isMax ? 'max-pos' : ''}${centerClass}" data-pos="${i}" data-aa="${aa}" data-activation="${activation.toFixed(2)}" style="background: ${color}; color: ${textColor}">${aa}</span>`;
        }
        alignedPos++;
    }

    // Right padding
    for (let i = 0; i < seq.rightPadding; i++) {
        const isCenter = alignedPos === centerPosition;
        html += `<span class="aa-char gap${isCenter ? ' center-line' : ''}">-</span>`;
        alignedPos++;
    }

    html += '</div></div>';

    return html;
}

// Render a single sequence card
function renderSequenceCard(item, rank) {
    const { Score, Activations, Sequence, 'Entry Name': entryName, 'Protein names': proteinNames, Entry, seq_len } = item;

    // Find max activation for color scaling
    const maxActivation = Math.max(...Activations);

    // Build amino acid visualization
    let aaHtml = '';
    for (let i = 0; i < Sequence.length; i++) {
        const aa = Sequence[i];
        const activation = Activations[i] || 0;

        if (activation === 0) {
            aaHtml += `<span class="aa-char zero" data-pos="${i}" data-aa="${aa}" data-activation="0.00">${aa}</span>`;
        } else {
            const color = getActivationColorForPanel(activation, 0, maxActivation);
            const textColor = activation > maxActivation * 0.5 ? '#000' : '#fff';
            aaHtml += `<span class="aa-char" data-pos="${i}" data-aa="${aa}" data-activation="${activation.toFixed(2)}" style="background: ${color}; color: ${textColor}">${aa}</span>`;
        }
    }

    return `
        <div class="seq-card">
            <div class="seq-card-header">
                <div class="seq-card-title">
                    <h3><span class="rank-badge">#${rank}</span>${Entry || 'N/A'} (${entryName || 'Unknown'})</h3>
                    <p class="protein-name">${proteinNames || 'Unknown protein'}</p>
                </div>
                <div class="seq-card-score">Score: ${Score.toFixed(2)}</div>
            </div>
            <div class="seq-card-meta">
                <span>Length: ${seq_len || Sequence.length} aa</span>
            </div>
            <div class="seq-visualization">
                <div class="seq-amino-acids">${aaHtml}</div>
            </div>
        </div>
    `;
}

// Color scale for panel activation values (yellow to red gradient)
function getActivationColorForPanel(value, minVal, maxVal) {
    if (maxVal === minVal) return 'rgb(255, 200, 0)';
    const t = (value - minVal) / (maxVal - minVal);
    const r = 255;
    const g = Math.round(200 * (1 - t));
    const b = 0;
    return `rgb(${r}, ${g}, ${b})`;
}

// Close panel handler
panelClose.addEventListener('click', () => {
    activationPanel.classList.add('hidden');
});

// Tooltip for amino acid hover
let aaTooltip = null;

function createTooltip() {
    if (!aaTooltip) {
        aaTooltip = document.createElement('div');
        aaTooltip.className = 'aa-tooltip';
        aaTooltip.style.display = 'none';
        document.body.appendChild(aaTooltip);
    }
    return aaTooltip;
}

function showAATooltip(e) {
    const target = e.target;
    if (!target.classList.contains('aa-char')) return;

    const pos = target.dataset.pos;
    const aa = target.dataset.aa;
    const activation = target.dataset.activation;

    const tooltip = createTooltip();
    tooltip.innerHTML = `<span class="tooltip-pos">Pos ${pos}</span><span class="tooltip-aa">${aa}</span><span class="tooltip-val">${activation}</span>`;
    tooltip.style.display = 'block';

    // Position tooltip near cursor
    const x = e.clientX + 10;
    const y = e.clientY - 30;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
}

function hideAATooltip(e) {
    if (aaTooltip) {
        aaTooltip.style.display = 'none';
    }
}

function moveAATooltip(e) {
    if (aaTooltip && aaTooltip.style.display !== 'none') {
        const x = e.clientX + 10;
        const y = e.clientY - 30;
        aaTooltip.style.left = x + 'px';
        aaTooltip.style.top = y + 'px';
    }
}

// Add tooltip listeners to panel content
panelContent.addEventListener('mouseover', showAATooltip);
panelContent.addEventListener('mouseout', hideAATooltip);
panelContent.addEventListener('mousemove', moveAATooltip);

// Add node to canvas
function addNodeToCanvas(latentIdx, layer, pos, aa, value, isSuper = false, children = []) {
    const id = nodeIdCounter++;
    const containerRect = nodesContainer.getBoundingClientRect();

    // Position new nodes in a grid pattern
    const nodesPerRow = 5;
    const nodeCount = canvasNodes.length;
    const x = 20 + (nodeCount % nodesPerRow) * 120;
    const y = 20 + Math.floor(nodeCount / nodesPerRow) * 80;

    const node = {
        id,
        x,
        y,
        latentIdx,
        layer,
        pos,
        aa,
        value,
        isSuper,
        children
    };

    canvasNodes.push(node);
    renderNode(node);
    return node;
}

// Render a single node
function renderNode(node) {
    const div = document.createElement('div');
    div.className = 'canvas-node' + (node.isSuper ? ' super-node' : '');
    div.dataset.id = node.id;
    div.style.left = node.x + 'px';
    div.style.top = node.y + 'px';

    if (node.isSuper) {
        const latentIds = node.children.map(c => 'L' + c.latentIdx).join(', ');
        div.innerHTML = `
            <div class="node-latent">${latentIds}</div>
            <div class="node-info">Super Node (${node.children.length} items)</div>
        `;
    } else {
        div.innerHTML = `
            <div class="node-latent">L${node.latentIdx}</div>
            <div class="node-info">Layer ${node.layer} | Pos ${node.pos} (${node.aa})</div>
        `;
    }

    // Event handlers
    div.addEventListener('mousedown', startDrag);
    div.addEventListener('click', handleNodeClick);

    nodesContainer.appendChild(div);
}

// Handle node click for selection
function handleNodeClick(e) {
    e.stopPropagation();
    const id = parseInt(e.currentTarget.dataset.id);

    if (e.ctrlKey || e.metaKey) {
        // Toggle selection
        if (selectedNodes.has(id)) {
            selectedNodes.delete(id);
        } else {
            selectedNodes.add(id);
        }
    } else {
        // Single select
        selectedNodes.clear();
        selectedEdges.clear();
        selectedNodes.add(id);
    }

    updateSelectionUI();
}

// Update selection visual
function updateSelectionUI() {
    nodesContainer.querySelectorAll('.canvas-node').forEach(el => {
        const id = parseInt(el.dataset.id);
        el.classList.toggle('selected', selectedNodes.has(id));
    });

    edgesSvg.querySelectorAll('line').forEach(el => {
        const id = parseInt(el.dataset.id);
        el.classList.toggle('selected', selectedEdges.has(id));
    });
}

// Drag handling
function startDrag(e) {
    if (e.button !== 0) return;

    const nodeEl = e.currentTarget;
    const id = parseInt(nodeEl.dataset.id);
    const node = canvasNodes.find(n => n.id === id);

    dragState = {
        node,
        nodeEl,
        startX: e.clientX,
        startY: e.clientY,
        origX: node.x,
        origY: node.y
    };

    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', endDrag);
    e.preventDefault();
}

function onDrag(e) {
    if (!dragState) return;

    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;

    dragState.node.x = dragState.origX + dx;
    dragState.node.y = dragState.origY + dy;
    dragState.nodeEl.style.left = dragState.node.x + 'px';
    dragState.nodeEl.style.top = dragState.node.y + 'px';

    updateEdges();
}

function endDrag() {
    dragState = null;
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', endDrag);
}

// Connect selected nodes
function connectNodes() {
    const selected = Array.from(selectedNodes);
    if (selected.length < 2) {
        alert('Select at least 2 nodes to connect');
        return;
    }

    // Connect each pair
    for (let i = 0; i < selected.length - 1; i++) {
        const fromId = selected[i];
        const toId = selected[i + 1];

        // Check if edge already exists
        const exists = edges.some(e =>
            (e.from === fromId && e.to === toId) ||
            (e.from === toId && e.to === fromId)
        );

        if (!exists) {
            const edge = { id: edgeIdCounter++, from: fromId, to: toId };
            edges.push(edge);
        }
    }

    updateEdges();
}

// Combine selected nodes into super node
function combineNodes() {
    const selected = Array.from(selectedNodes);
    if (selected.length < 2) {
        alert('Select at least 2 nodes to combine');
        return;
    }

    // Gather all children
    const children = [];
    for (const id of selected) {
        const node = canvasNodes.find(n => n.id === id);
        if (node.isSuper) {
            children.push(...node.children);
        } else {
            children.push({ latentIdx: node.latentIdx, layer: node.layer, pos: node.pos, aa: node.aa });
        }
    }

    // Calculate center position
    let sumX = 0, sumY = 0;
    for (const id of selected) {
        const node = canvasNodes.find(n => n.id === id);
        sumX += node.x;
        sumY += node.y;
    }
    const centerX = sumX / selected.length;
    const centerY = sumY / selected.length;

    // Remove old nodes and their edges
    deleteSelectedInternal(selected);

    // Create super node
    const superNode = addNodeToCanvas(null, null, null, null, null, true, children);
    superNode.x = centerX;
    superNode.y = centerY;

    const nodeEl = nodesContainer.querySelector(`[data-id="${superNode.id}"]`);
    nodeEl.style.left = superNode.x + 'px';
    nodeEl.style.top = superNode.y + 'px';

    selectedNodes.clear();
    updateSelectionUI();
}

// Delete selected nodes/edges
function deleteSelected() {
    if (selectedNodes.size === 0 && selectedEdges.size === 0) {
        alert('Nothing selected to delete');
        return;
    }

    // Delete edges first
    for (const edgeId of selectedEdges) {
        const idx = edges.findIndex(e => e.id === edgeId);
        if (idx !== -1) edges.splice(idx, 1);
    }

    deleteSelectedInternal(Array.from(selectedNodes));

    selectedNodes.clear();
    selectedEdges.clear();
    updateEdges();
    updateSelectionUI();
}

function deleteSelectedInternal(nodeIds) {
    for (const id of nodeIds) {
        // Remove edges connected to this node
        edges = edges.filter(e => e.from !== id && e.to !== id);

        // Remove node
        const idx = canvasNodes.findIndex(n => n.id === id);
        if (idx !== -1) canvasNodes.splice(idx, 1);

        // Remove DOM element
        const el = nodesContainer.querySelector(`[data-id="${id}"]`);
        if (el) el.remove();
    }
}

// Update edge rendering
function updateEdges() {
    edgesSvg.innerHTML = '';

    for (const edge of edges) {
        const fromNode = canvasNodes.find(n => n.id === edge.from);
        const toNode = canvasNodes.find(n => n.id === edge.to);

        if (!fromNode || !toNode) continue;

        const fromEl = nodesContainer.querySelector(`[data-id="${fromNode.id}"]`);
        const toEl = nodesContainer.querySelector(`[data-id="${toNode.id}"]`);

        if (!fromEl || !toEl) continue;

        const fromX = fromNode.x + fromEl.offsetWidth / 2;
        const fromY = fromNode.y + fromEl.offsetHeight / 2;
        const toX = toNode.x + toEl.offsetWidth / 2;
        const toY = toNode.y + toEl.offsetHeight / 2;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', fromX);
        line.setAttribute('y1', fromY);
        line.setAttribute('x2', toX);
        line.setAttribute('y2', toY);
        line.dataset.id = edge.id;
        line.style.pointerEvents = 'stroke';

        line.addEventListener('click', (e) => {
            e.stopPropagation();
            if (e.ctrlKey || e.metaKey) {
                if (selectedEdges.has(edge.id)) {
                    selectedEdges.delete(edge.id);
                } else {
                    selectedEdges.add(edge.id);
                }
            } else {
                selectedNodes.clear();
                selectedEdges.clear();
                selectedEdges.add(edge.id);
            }
            updateSelectionUI();
        });

        edgesSvg.appendChild(line);
    }
}

// Clear selection when clicking canvas background
document.getElementById('canvas-container').addEventListener('click', (e) => {
    if (e.target.id === 'canvas-container' || e.target.id === 'nodes-container') {
        selectedNodes.clear();
        selectedEdges.clear();
        updateSelectionUI();
    }
});

// Button handlers
btnConnect.addEventListener('click', connectNodes);
btnCombine.addEventListener('click', combineNodes);
btnDelete.addEventListener('click', deleteSelected);

// Fullscreen toggle
const btnFullscreen = document.getElementById('btn-fullscreen');
const canvasSection = document.getElementById('canvas-section');

btnFullscreen.addEventListener('click', () => {
    canvasSection.classList.toggle('fullscreen');
    btnFullscreen.textContent = canvasSection.classList.contains('fullscreen') ? 'Exit Fullscreen' : 'Fullscreen';
    // Redraw edges after resize
    setTimeout(updateEdges, 100);
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodes.size > 0 || selectedEdges.size > 0) {
            deleteSelected();
            e.preventDefault();
        }
    }
    if (e.key === 'Escape') {
        // Close activation panel first if open
        if (!activationPanel.classList.contains('hidden')) {
            activationPanel.classList.add('hidden');
        } else if (canvasSection.classList.contains('fullscreen')) {
            canvasSection.classList.remove('fullscreen');
            btnFullscreen.textContent = 'Fullscreen';
            setTimeout(updateEdges, 100);
        }
    }
});
