(function(){

  // ---------------- State ----------------
  let topics = [];          // { id, text, edits: [], nextEditNumber, proposalDraft }
  let selectedTopicId = 'new';
  let newTopicDraft = '';
  let idCounter = 1;

  function nextId(prefix){ return prefix + '-' + (idCounter++); }

  // ---------------- DOM refs ----------------
  const appLayout = document.getElementById('appLayout');
  const topicTextArea = document.getElementById('topicTextArea');
  const topicStatus = document.getElementById('topicStatus');
  const topicSelect = document.getElementById('topicSelect');
  const startNewBtn = document.getElementById('startNewBtn');
  const newTopicNote = document.getElementById('newTopicNote');

  const editsSection = document.getElementById('editsSection');
  const editsCount = document.getElementById('editsCount');
  const proposalCard = document.getElementById('proposalCard');
  const proposalTitleInput = document.getElementById('proposalTitleInput');
  const proposalTextArea = document.getElementById('proposalTextArea');
  const proposeBtn = document.getElementById('proposeBtn');
  const proposalNote = document.getElementById('proposalNote');
  const editsList = document.getElementById('editsList');
  const voteBtn = document.getElementById('voteBtn');
  const voteCaption = document.getElementById('voteCaption');

  // ---------------- Diff engine ----------------

  // Generic LCS-based array diff. Returns ops: {type:'same'|'del'|'add', oldItem, newItem}
  function diffArrays(oldArr, newArr){
    const n = oldArr.length, m = newArr.length;
    const dp = new Array(n + 1);
    for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
    for (let i = n - 1; i >= 0; i--){
      for (let j = m - 1; j >= 0; j--){
        dp[i][j] = (oldArr[i] === newArr[j])
          ? dp[i+1][j+1] + 1
          : Math.max(dp[i+1][j], dp[i][j+1]);
      }
    }
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m){
      if (oldArr[i] === newArr[j]){
        ops.push({ type:'same', oldItem: oldArr[i], newItem: newArr[j] });
        i++; j++;
      } else if (dp[i+1][j] >= dp[i][j+1]){
        ops.push({ type:'del', oldItem: oldArr[i] });
        i++;
      } else {
        ops.push({ type:'add', newItem: newArr[j] });
        j++;
      }
    }
    while (i < n){ ops.push({ type:'del', oldItem: oldArr[i] }); i++; }
    while (j < m){ ops.push({ type:'add', newItem: newArr[j] }); j++; }
    return ops;
  }

  function tokenizeWords(line){
    return line.split(/(\s+)/).filter(t => t.length > 0);
  }

  // Produces a "Change": an ordered list of TextEdit-like rows describing
  // how to splice oldText into newText, with word-level detail on modified lines.
  function computeChange(oldText, newText){
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const rawOps = diffArrays(oldLines, newLines);

    const rows = [];
    let i = 0;
    while (i < rawOps.length){
      const op = rawOps[i];
      if (op.type === 'same'){
        rows.push({ type:'same', text: op.oldItem });
        i++;
        continue;
      }
      // Collect a contiguous run of non-'same' ops (a changed block)
      let j = i;
      const dels = [], adds = [];
      while (j < rawOps.length && rawOps[j].type !== 'same'){
        if (rawOps[j].type === 'del') dels.push(rawOps[j].oldItem);
        else adds.push(rawOps[j].newItem);
        j++;
      }
      const pairCount = Math.min(dels.length, adds.length);
      for (let k = 0; k < pairCount; k++){
        const wordOps = diffArrays(tokenizeWords(dels[k]), tokenizeWords(adds[k]));
        rows.push({ type:'del', text: dels[k], wordOps });
        rows.push({ type:'add', text: adds[k], wordOps });
      }
      for (let k = pairCount; k < dels.length; k++) rows.push({ type:'del', text: dels[k] });
      for (let k = pairCount; k < adds.length; k++) rows.push({ type:'add', text: adds[k] });
      i = j;
    }

    let oldNum = 1, newNum = 1;
    for (const row of rows){
      if (row.type === 'same'){ row.oldNum = oldNum++; row.newNum = newNum++; }
      else if (row.type === 'del'){ row.oldNum = oldNum++; row.newNum = null; }
      else { row.oldNum = null; row.newNum = newNum++; }
    }
    return rows;
  }

  function esc(s){
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function countChanges(rows){
    let add = 0, del = 0;
    for (const r of rows){
      if (r.type === 'add') add++;
      if (r.type === 'del') del++;
    }
    return { add, del };
  }

  function renderDiffRow(row){
    const oldNum = row.oldNum != null ? row.oldNum : '';
    const newNum = row.newNum != null ? row.newNum : '';

    if (row.type === 'same'){
      const content = esc(row.text) || '&nbsp;';
      return `<div class="diff-row diff-row--same">
        <span class="ln ln-old">${oldNum}</span><span class="ln ln-new">${newNum}</span>
        <span class="marker"> </span>
        <span class="content">${content}</span>
      </div>`;
    }

    if (row.type === 'del'){
      let content;
      if (row.wordOps){
        content = row.wordOps.filter(t => t.type !== 'add').map(t =>
          t.type === 'del'
            ? `<span class="tok-del">${esc(t.oldItem)}</span>`
            : `<span>${esc(t.oldItem)}</span>`
        ).join('');
      } else {
        content = `<span class="tok-del">${esc(row.text)}</span>`;
      }
      return `<div class="diff-row diff-row--del">
        <span class="ln ln-old">${oldNum}</span><span class="ln ln-new"></span>
        <span class="marker">&minus;</span>
        <span class="content">${content || '&nbsp;'}</span>
      </div>`;
    }

    // add
    let content;
    if (row.wordOps){
      content = row.wordOps.filter(t => t.type !== 'del').map(t =>
        t.type === 'add'
          ? `<span class="tok-add">${esc(t.newItem)}</span>`
          : `<span>${esc(t.newItem)}</span>`
      ).join('');
    } else {
      content = `<span class="tok-add">${esc(row.text)}</span>`;
    }
    return `<div class="diff-row diff-row--add">
      <span class="ln ln-old"></span><span class="ln ln-new">${newNum}</span>
      <span class="marker">+</span>
      <span class="content">${content || '&nbsp;'}</span>
    </div>`;
  }

  // ---------------- Helpers ----------------

  function currentTopic(){
    return topics.find(t => t.id === selectedTopicId) || null;
  }

  function topicLabel(topic){
    const firstLine = (topic.text.split('\n')[0] || '').trim() || '(untitled topic)';
    return firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine;
  }

  function autoGrow(el, minHeight = 90){
    el.style.height = 'auto';
    el.style.height = Math.max(el.scrollHeight, minHeight) + 'px';
  }

  function updateProposalTextareaSize(isFocused){
    const isEmpty = proposalTextArea.value.trim() === '';
    if (!isFocused && isEmpty){
      proposalTextArea.classList.remove('expanded');
      proposalTextArea.style.height = '';
    } else {
      proposalTextArea.classList.add('expanded');
      proposalTextArea.style.height = 'auto';
      proposalTextArea.style.height = Math.max(proposalTextArea.scrollHeight, 110) + 'px';
    }
  }

  // ---------------- Rendering ----------------

  function renderTopicSelect(){
    topicSelect.innerHTML = '';
    const newOpt = document.createElement('option');
    newOpt.value = 'new';
    newOpt.textContent = 'new topic';
    topicSelect.appendChild(newOpt);

    for (const t of topics){
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = topicLabel(t);
      topicSelect.appendChild(opt);
    }
    topicSelect.value = selectedTopicId;
  }

  function renderTopicTextArea(){
    const topic = currentTopic();
    if (selectedTopicId === 'new'){
      topicTextArea.value = newTopicDraft;
      topicTextArea.readOnly = false;
      topicTextArea.classList.remove('is-readonly');
      startNewBtn.style.display = '';
      topicStatus.classList.add('editing');
      topicStatus.innerHTML = `<span class="dot"></span> Drafting a new topic — editable`;
      autoGrow(topicTextArea, 90);
    } else if (topic){
      topicTextArea.value = topic.text;
      topicTextArea.readOnly = true;
      topicTextArea.classList.add('is-readonly');
      topicTextArea.style.height = '';
      startNewBtn.style.display = 'none';
      topicStatus.classList.remove('editing');
      topicStatus.innerHTML = `<span class="dot"></span> Locked — select "new topic" to draft another`;
    }
  }

  function renderEditsSection(){
    const topic = currentTopic();
    if (selectedTopicId === 'new' || !topic){
      if (proposalCard) proposalCard.style.display = 'none';
      editsSection.style.display = 'none';
      if (appLayout) appLayout.classList.add('single-column');
      return;
    }
    if (proposalCard) proposalCard.style.display = '';
    editsSection.style.display = '';
    if (appLayout) appLayout.classList.remove('single-column');

    proposalTextArea.value = topic.proposalDraft;
    updateProposalTextareaSize(document.activeElement === proposalTextArea);
    editsCount.textContent = topic.edits.length === 1 ? '1 proposal' : `${topic.edits.length} proposals`;

    if (topic.edits.length === 0){
      editsList.innerHTML = `<p class="empty-state">No edits proposed yet — draft one above and press "Propose edit".</p>`;
    } else {
      editsList.innerHTML = topic.edits.map(edit => {
        const stats = countChanges(edit.change);
        const diffHtml = edit.change.map(renderDiffRow).join('');
        const isCollapsed = !!edit.collapsed;
        const arrow = isCollapsed ? '&#9654;' : '&#9660;';
        const arrowLabel = isCollapsed ? 'Expand edit diff' : 'Collapse edit diff';
        const displayTitle = edit.title || `Edit #${edit.number}`;

        return `<section class="card edit-card ${edit.voteChecked ? '' : 'excluded'}" draggable="true" data-edit-id="${edit.id}">
          <div class="edit-card-header">
            <span class="drag-handle" title="Drag to reorder">&#10247;</span>
            <button type="button" class="collapse-toggle-btn" data-collapse-id="${edit.id}" aria-label="${arrowLabel}" title="${arrowLabel}">
              <span class="collapse-arrow">${arrow}</span>
            </button>
            <span class="edit-name">${esc(displayTitle)}</span>
            <span class="edit-stats"><span class="add-count">+${stats.add}</span> <span class="del-count">−${stats.del}</span></span>
            <label class="vote-toggle">
              <input type="checkbox" data-vote-edit-id="${edit.id}" ${edit.voteChecked ? 'checked' : ''} aria-label="Count ${esc(displayTitle)} toward vote" />
              <span class="vote-label">${edit.voteChecked ? 'Counts toward vote' : 'Excluded from tally'}</span>
            </label>
          </div>
          <div class="diff-body" style="${isCollapsed ? 'display: none;' : ''}">${diffHtml}</div>
        </section>`;
      }).join('');
    }

    const hasEdits = topic.edits.length > 0;
    voteBtn.disabled = !hasEdits;
    voteCaption.textContent = hasEdits
      ? 'Tallying isn\'t wired up yet — this is a placeholder for ranked-choice voting.'
      : 'Propose at least one edit to enable voting.';
  }

  function render(){
    renderTopicSelect();
    renderTopicTextArea();
    renderEditsSection();
  }

  // ---------------- Actions ----------------

  function selectTopic(id){
    selectedTopicId = id;
    if (id === 'new'){
      newTopicDraft = '';
    } else {
      const topic = topics.find(t => t.id === id);
      if (topic){
        topic.proposalDraft = topic.text;
      }
    }
    hideNote(newTopicNote);
    hideNote(proposalNote);
    render();
    if (id === 'new') topicTextArea.focus();
  }

  function startNewTopic(){
    const text = topicTextArea.value.trim();
    if (!text){
      showNote(newTopicNote, 'Add some text before starting a topic.');
      topicTextArea.focus();
      return;
    }
    const topic = {
      id: nextId('topic'),
      text: text,
      edits: [],
      nextEditNumber: 1,
      proposalDraft: text
    };
    topics.push(topic);
    selectedTopicId = topic.id;
    hideNote(newTopicNote);
    render();
  }

  function proposeEdit(){
    const topic = currentTopic();
    if (!topic) return;
    const proposedText = proposalTextArea.value;

    if (!proposedText.trim()){
      showNote(proposalNote, 'Enter proposed text before proposing.');
      return;
    }
    if (proposedText.trim() === topic.text.trim()){
      showNote(proposalNote, 'This matches the current topic text — nothing to propose.');
      return;
    }
    hideNote(proposalNote);

    const change = computeChange(topic.text, proposedText);
    const editNumber = topic.nextEditNumber++;
    const userTitle = proposalTitleInput ? proposalTitleInput.value.trim() : '';
    const title = userTitle || `Edit #${editNumber}`;

    const edit = {
      id: nextId('edit'),
      number: editNumber,
      title: title,
      proposedText: proposedText,
      change: change,
      voteChecked: true,
      collapsed: false
    };
    topic.edits.unshift(edit); // appears directly below the Edit Proposal box
    topic.proposalDraft = topic.text; // reset the proposal box to baseline topic text
    if (proposalTitleInput) proposalTitleInput.value = '';
    render();
  }

  function toggleVote(editId){
    const topic = currentTopic();
    if (!topic) return;
    const edit = topic.edits.find(e => e.id === editId);
    if (!edit) return;
    edit.voteChecked = !edit.voteChecked;
    render();
  }

  function showNote(el, msg){ el.textContent = msg; el.style.display = ''; }
  function hideNote(el){ el.textContent = ''; el.style.display = 'none'; }

  // ---------------- Drag and drop reordering ----------------

  let dragSrcId = null;

  function attachDragHandlers(){
    editsList.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.edit-card');
      if (!card) return;
      dragSrcId = card.dataset.editId;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragSrcId); } catch(err){}
    });

    editsList.addEventListener('dragend', (e) => {
      const card = e.target.closest('.edit-card');
      if (card) card.classList.remove('dragging');
      editsList.querySelectorAll('.edit-card').forEach(c => {
        c.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      dragSrcId = null;
    });

    editsList.addEventListener('dragover', (e) => {
      const card = e.target.closest('.edit-card');
      if (!card || !dragSrcId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = card.getBoundingClientRect();
      const isTopHalf = (e.clientY - rect.top) < rect.height / 2;
      card.classList.toggle('drag-over-top', isTopHalf);
      card.classList.toggle('drag-over-bottom', !isTopHalf);
    });

    editsList.addEventListener('dragleave', (e) => {
      const card = e.target.closest('.edit-card');
      if (card) card.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    editsList.addEventListener('drop', (e) => {
      const card = e.target.closest('.edit-card');
      if (!card || !dragSrcId) return;
      e.preventDefault();
      const targetId = card.dataset.editId;
      card.classList.remove('drag-over-top', 'drag-over-bottom');
      if (targetId === dragSrcId) return;

      const topic = currentTopic();
      if (!topic) return;
      const rect = card.getBoundingClientRect();
      const isTopHalf = (e.clientY - rect.top) < rect.height / 2;

      const srcIndex = topic.edits.findIndex(ed => ed.id === dragSrcId);
      if (srcIndex === -1) return;
      const [moved] = topic.edits.splice(srcIndex, 1);

      let targetIndex = topic.edits.findIndex(ed => ed.id === targetId);
      if (targetIndex === -1) targetIndex = topic.edits.length;
      const insertAt = isTopHalf ? targetIndex : targetIndex + 1;
      topic.edits.splice(insertAt, 0, moved);

      render();
    });

    editsList.addEventListener('change', (e) => {
      if (e.target.matches('[data-vote-edit-id]')){
        toggleVote(e.target.dataset.voteEditId);
      }
    });

    editsList.addEventListener('click', (e) => {
      const toggleBtn = e.target.closest('[data-collapse-id]');
      if (toggleBtn){
        const editId = toggleBtn.dataset.collapseId;
        const topic = currentTopic();
        if (!topic) return;
        const edit = topic.edits.find(ed => ed.id === editId);
        if (edit){
          edit.collapsed = !edit.collapsed;
          renderEditsSection();
        }
      }
    });
  }

  // ---------------- Wire up static controls ----------------

  topicSelect.addEventListener('change', () => selectTopic(topicSelect.value));
  startNewBtn.addEventListener('click', startNewTopic);
  proposeBtn.addEventListener('click', proposeEdit);
  voteBtn.addEventListener('click', () => { /* ranked-choice voting: not yet implemented */ });

  topicTextArea.addEventListener('input', () => {
    if (selectedTopicId === 'new'){
      newTopicDraft = topicTextArea.value;
      hideNote(newTopicNote);
    }
    autoGrow(topicTextArea, 90);
  });

  proposalTextArea.addEventListener('focus', () => {
    updateProposalTextareaSize(true);
  });

  proposalTextArea.addEventListener('blur', () => {
    updateProposalTextareaSize(false);
  });

  proposalTextArea.addEventListener('input', () => {
    const topic = currentTopic();
    if (topic){
      topic.proposalDraft = proposalTextArea.value;
      hideNote(proposalNote);
    }
    updateProposalTextareaSize(true);
  });

  attachDragHandlers();
  render();

})();