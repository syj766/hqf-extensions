const STORAGE_KEY = 'linkGroups'
const LEGACY_KEY = 'favLinks'
const ACTIVE_KEY = 'activeGroupId'
const MAX_GROUPS = 20
const MAX_SUGGESTED = 20
const DEFAULT_GROUP_NAMES = ['工作', '学习', '休闲']

function sendTrack(eventName, params) {
  chrome.runtime.sendMessage({
    type: '__track__',
    eventName,
    params: params || {},
  }, () => {
    chrome.runtime.lastError
  })
}

function normalizeUrl(raw) {
  let value = String(raw || '').trim()
  if (!value)
    return ''

  value = value.replace(/^[,;，；、\s]+/, '').replace(/[,;，；、\s]+$/, '')
  if (!value)
    return ''

  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value))
    value = `https://${value}`

  if (!/^https?:\/\/\S+\.\S+/.test(value))
    return ''

  return value
}

function createDefaultGroups() {
  return DEFAULT_GROUP_NAMES.map((name, index) => ({
    id: `group-${index + 1}-${Date.now()}`,
    name,
    links: [],
  }))
}

function sanitizeGroups(raw) {
  if (!Array.isArray(raw))
    return null

  const groups = raw
    .filter((group) => group && typeof group === 'object')
    .map((group, index) => ({
      id: typeof group.id === 'string' && group.id ? group.id : `group-${index + 1}-${Date.now()}`,
      name: typeof group.name === 'string' && group.name.trim() ? group.name.trim().slice(0, 20) : `分组 ${index + 1}`,
      links: Array.isArray(group.links)
        ? group.links
            .filter((link) => link && typeof link === 'object')
            .map((link) => ({
              url: typeof link.url === 'string' ? link.url : '',
              enabled: link.enabled !== false,
            }))
        : [],
    }))

  return groups.length ? groups : null
}

function hostOf(rawUrl) {
  const url = normalizeUrl(rawUrl)
  if (!url)
    return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  }
  catch {
    return ''
  }
}

function faviconUrlFor(rawUrl) {
  const url = normalizeUrl(rawUrl)
  if (!url)
    return ''
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return ''
    return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`)
  }
  catch {
    return ''
  }
}

function iconFallback(rawUrl) {
  const host = hostOf(rawUrl)
  if (!host)
    return { letter: '?', color: '#94a3b8' }
  let hash = 0
  for (let i = 0; i < host.length; i += 1)
    hash = (hash * 31 + host.charCodeAt(i)) >>> 0
  return { letter: host.charAt(0).toUpperCase(), color: `hsl(${hash % 360}, 58%, 52%)` }
}

function paintIcon(container, rawUrl) {
  container.textContent = ''
  const fallback = iconFallback(rawUrl)
  const src = faviconUrlFor(rawUrl)

  if (!src) {
    container.className = 'link-favicon is-fallback'
    container.style.background = fallback.color
    container.textContent = fallback.letter
    return
  }

  const img = document.createElement('img')
  img.alt = ''
  img.src = src
  img.addEventListener('error', () => {
    container.className = 'link-favicon is-fallback'
    container.style.background = fallback.color
    container.textContent = fallback.letter
  })
  container.className = 'link-favicon'
  container.style.background = ''
  container.appendChild(img)
}

function openTabs(urls) {
  return urls.reduce((chain, url) => chain.then((report) => {
    return new Promise((resolve) => {
      chrome.tabs.create({ url, active: false }, (tab) => {
        if (chrome.runtime.lastError || !tab)
          report.failed.push({ url, reason: chrome.runtime.lastError?.message || '浏览器未能创建标签页' })
        else
          report.opened.push(url)
        resolve(report)
      })
    })
  }), Promise.resolve({ opened: [], failed: [] }))
}

function statusClass(kind) {
  const map = {
    info: 'status is-visible is-info',
    success: 'status is-visible is-success',
    warning: 'status is-visible is-warning',
    error: 'status is-visible is-error',
  }
  return map[kind] || map.info
}

function renderResult(element, kind, title, items) {
  element.className = statusClass(kind)
  element.textContent = ''

  const heading = document.createElement('div')
  heading.className = 'status-title'
  heading.textContent = title
  element.appendChild(heading)

  if (items && items.length) {
    const list = document.createElement('ul')
    list.className = 'status-list'
    for (const item of items) {
      const li = document.createElement('li')
      li.textContent = item
      list.appendChild(li)
    }
    element.appendChild(list)
  }
}

function clearResult(element) {
  element.className = 'status'
  element.textContent = ''
}

document.addEventListener('DOMContentLoaded', () => {
  const groupBar = document.querySelector('#groupBar')
  const groupName = document.querySelector('#groupName')
  const renameGroup = document.querySelector('#renameGroup')
  const deleteGroup = document.querySelector('#deleteGroup')
  const linkList = document.querySelector('#linkList')
  const emptyHint = document.querySelector('#emptyHint')
  const addLink = document.querySelector('#addLink')
  const saveState = document.querySelector('#saveState')
  const selCount = document.querySelector('#selCount')
  const openGroup = document.querySelector('#openGroup')
  const statusArea = document.querySelector('#statusArea')

  let groups = []
  let activeGroupId = ''
  let deleteArmed = false
  let deleteArmTimer = 0
  let dragGroupId = ''
  let dragLinkIndex = -1

  function activeGroup() {
    return groups.find((group) => group.id === activeGroupId) || groups[0]
  }

  function readStore() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY, ACTIVE_KEY, LEGACY_KEY], (items) => {
        const stored = sanitizeGroups(items?.[STORAGE_KEY])
        if (stored) {
          resolve({ groups: stored, activeGroupId: items?.[ACTIVE_KEY] || stored[0].id, migrated: false })
          return
        }

        const legacy = Array.isArray(items?.[LEGACY_KEY]) ? items[LEGACY_KEY] : []
        const fresh = createDefaultGroups()
        if (legacy.length) {
          fresh[0].links = legacy
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => ({ url: typeof entry.url === 'string' ? entry.url : '', enabled: entry.enabled !== false }))
        }
        resolve({ groups: fresh, activeGroupId: fresh[0].id, migrated: true })
      })
    })
  }

  function writeStore() {
    const payload = groups.map((group) => ({
      id: group.id,
      name: group.name,
      links: group.links.map((link) => ({ url: link.url, enabled: link.enabled })),
    }))
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: payload, [ACTIVE_KEY]: activeGroupId }, () => {
        if (chrome.runtime.lastError) {
          saveState.textContent = '保存失败，请重试'
          saveState.className = 'save-state is-error'
          resolve(false)
          return
        }
        saveState.textContent = '已自动保存'
        saveState.className = 'save-state'
        resolve(true)
      })
    })
  }

  function selectedUrls() {
    return activeGroup().links
      .filter((link) => link.enabled)
      .map((link) => normalizeUrl(link.url))
      .filter(Boolean)
  }

  function refreshMeta() {
    const group = activeGroup()
    const total = group.links.length
    const selected = selectedUrls().length
    selCount.textContent = `已选 ${selected} / ${total} 个`
    openGroup.disabled = selected === 0
    emptyHint.hidden = total > 0
    linkList.hidden = total === 0
  }

  function renderGroupBar() {
    groupBar.textContent = ''
    groups.forEach((group) => {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = group.id === activeGroupId ? 'group-chip is-active' : 'group-chip'
      chip.textContent = group.name
      chip.title = group.name
      chip.draggable = true
      chip.addEventListener('click', () => switchGroup(group.id))
      chip.addEventListener('dragstart', (event) => {
        dragGroupId = group.id
        chip.classList.add('is-dragging')
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', group.id)
        }
      })
      chip.addEventListener('dragover', (event) => {
        if (!dragGroupId || dragGroupId === group.id)
          return
        event.preventDefault()
        chip.classList.add('is-drop-target')
      })
      chip.addEventListener('dragleave', () => chip.classList.remove('is-drop-target'))
      chip.addEventListener('drop', (event) => {
        if (!dragGroupId || dragGroupId === group.id)
          return
        event.preventDefault()
        chip.classList.remove('is-drop-target')
        moveGroupTo(dragGroupId, group.id)
        dragGroupId = ''
      })
      chip.addEventListener('dragend', () => {
        dragGroupId = ''
        clearDragClasses()
      })
      groupBar.appendChild(chip)
    })

    const addChip = document.createElement('button')
    addChip.type = 'button'
    addChip.className = 'group-chip is-add'
    addChip.textContent = '＋'
    addChip.title = '新建分组'
    addChip.addEventListener('click', addNewGroup)
    addChip.addEventListener('dragover', (event) => {
      if (!dragGroupId)
        return
      event.preventDefault()
      addChip.classList.add('is-drop-target')
    })
    addChip.addEventListener('dragleave', () => addChip.classList.remove('is-drop-target'))
    addChip.addEventListener('drop', (event) => {
      if (!dragGroupId)
        return
      event.preventDefault()
      addChip.classList.remove('is-drop-target')
      const from = groups.findIndex((group) => group.id === dragGroupId)
      const last = groups[groups.length - 1]
      if (from !== -1 && last && last.id !== dragGroupId)
        moveGroupTo(dragGroupId, last.id)
      dragGroupId = ''
    })
    addChip.addEventListener('dragend', () => {
      dragGroupId = ''
      clearDragClasses()
    })
    groupBar.appendChild(addChip)
  }

  function renderLinks() {
    const group = activeGroup()
    linkList.textContent = ''
    group.links.forEach((link, index) => {
      const item = document.createElement('li')
      item.className = 'link-item'

      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = link.enabled
      checkbox.setAttribute('aria-label', '选择该网址')
      checkbox.addEventListener('change', () => {
        link.enabled = checkbox.checked
        persist('toggle')
      })

      const icon = document.createElement('span')
      icon.className = 'link-favicon'
      icon.setAttribute('aria-hidden', 'true')
      paintIcon(icon, link.url)
      let lastHost = hostOf(link.url)

      const input = document.createElement('input')
      input.type = 'text'
      input.className = 'link-url'
      input.value = link.url
      input.placeholder = 'https://example.com'
      input.setAttribute('aria-label', '网址')
      input.addEventListener('input', () => {
        link.url = input.value
        const host = hostOf(input.value)
        if (host !== lastHost) {
          lastHost = host
          paintIcon(icon, input.value)
        }
        refreshMeta()
      })
      input.addEventListener('change', () => persist('edit'))
      input.addEventListener('blur', () => persist('edit'))

      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'link-remove'
      remove.textContent = '✕'
      remove.title = '删除'
      remove.setAttribute('aria-label', '删除该网址')
      remove.addEventListener('click', () => {
        group.links.splice(index, 1)
        persist('remove')
        renderLinks()
      })

      const handle = document.createElement('span')
      handle.className = 'drag-handle'
      handle.textContent = '⋮⋮'
      handle.title = '拖动调整顺序'
      handle.setAttribute('aria-hidden', 'true')
      handle.draggable = true
      handle.addEventListener('dragstart', (event) => {
        dragLinkIndex = index
        item.classList.add('is-dragging')
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', String(index))
          try {
            event.dataTransfer.setDragImage(item, 16, 16)
          }
          catch {
            // 部分环境不支持自定义拖动预览，忽略即可
          }
        }
      })
      handle.addEventListener('dragend', () => {
        dragLinkIndex = -1
        clearDragClasses()
      })

      item.addEventListener('dragover', (event) => {
        if (dragLinkIndex === -1 || dragLinkIndex === index)
          return
        event.preventDefault()
        item.classList.add('is-drop-target')
      })
      item.addEventListener('dragleave', () => item.classList.remove('is-drop-target'))
      item.addEventListener('drop', (event) => {
        if (dragLinkIndex === -1 || dragLinkIndex === index)
          return
        event.preventDefault()
        item.classList.remove('is-drop-target')
        const from = dragLinkIndex
        dragLinkIndex = -1
        moveLinkTo(from, index)
      })

      item.append(handle, checkbox, icon, input, remove)
      linkList.appendChild(item)
    })

    groupName.textContent = group.name
    refreshMeta()
  }

  function renderAll() {
    renderGroupBar()
    renderLinks()
  }

  function persist(action) {
    refreshMeta()
    return writeStore().then((ok) => {
      if (ok && action)
        sendTrack('list_modified', { action, group_count: groups.length })
    })
  }

  function clearDragClasses() {
    groupBar.querySelectorAll('.is-dragging, .is-drop-target').forEach((el) => {
      el.classList.remove('is-dragging', 'is-drop-target')
    })
    linkList.querySelectorAll('.is-dragging, .is-drop-target').forEach((el) => {
      el.classList.remove('is-dragging', 'is-drop-target')
    })
  }

  function moveGroupTo(sourceId, targetId) {
    const from = groups.findIndex((group) => group.id === sourceId)
    const to = groups.findIndex((group) => group.id === targetId)
    if (from === -1 || to === -1 || from === to) {
      clearDragClasses()
      return
    }
    const [moved] = groups.splice(from, 1)
    groups.splice(to, 0, moved)
    clearDragClasses()
    renderAll()
    persist('reorder_group')
    sendTrack('group_modified', { action: 'reorder', group_count: groups.length })
    renderResult(statusArea, 'success', '已调整分组顺序', ['新顺序已自动保存。'])
  }

  function moveLinkTo(from, to) {
    const group = activeGroup()
    if (from === to || from < 0 || to < 0 || from >= group.links.length || to >= group.links.length)
      return
    const [moved] = group.links.splice(from, 1)
    group.links.splice(to, 0, moved)
    renderLinks()
    persist('reorder_link')
    renderResult(statusArea, 'success', '已调整网址顺序', ['新顺序已自动保存。'])
  }

  function switchGroup(id) {
    if (id === activeGroupId)
      return
    activeGroupId = id
    deleteArmed = false
    deleteGroup.classList.remove('is-confirming')
    deleteGroup.textContent = '删除分组'
    clearResult(statusArea)
    renderAll()
    writeStore()
    sendTrack('group_switched', { group_index: groups.findIndex((group) => group.id === id) })
  }

  function addNewGroup() {
    if (groups.length >= MAX_GROUPS) {
      renderResult(statusArea, 'warning', `最多 ${MAX_GROUPS} 个分组`, ['可删除不再使用的分组后再新建。'])
      return
    }
    const group = {
      id: `group-${groups.length + 1}-${Date.now()}`,
      name: `分组 ${groups.length + 1}`,
      links: [],
    }
    groups.push(group)
    activeGroupId = group.id
    renderAll()
    persist('create_group')
    sendTrack('group_modified', { action: 'create', group_count: groups.length })
    renderResult(statusArea, 'success', '已新建分组', ['可以直接开始添加网址。'])
    const inputs = linkList.querySelectorAll('.link-url')
    if (inputs.length)
      inputs[inputs.length - 1].focus()
  }

  function startRename() {
    const group = activeGroup()
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'group-name-input'
    input.value = group.name
    input.setAttribute('aria-label', '分组名称')
    groupName.textContent = ''
    groupName.appendChild(input)
    input.focus()
    input.select()

    let committed = false
    function commit() {
      if (committed)
        return
      committed = true
      const value = input.value.trim().slice(0, 20)
      if (value)
        group.name = value
      renderAll()
      persist(value ? 'rename_group' : null)
      if (value)
        sendTrack('group_modified', { action: 'rename', group_count: groups.length })
    }

    input.addEventListener('blur', commit)
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter')
        commit()
      if (event.key === 'Escape') {
        committed = true
        renderAll()
      }
    })
  }

  function armDelete() {
    if (groups.length <= 1) {
      renderResult(statusArea, 'warning', '无法删除分组', ['至少要保留一个分组。'])
      return
    }

    if (!deleteArmed) {
      deleteArmed = true
      deleteGroup.classList.add('is-confirming')
      deleteGroup.textContent = '确认删除？'
      window.clearTimeout(deleteArmTimer)
      deleteArmTimer = window.setTimeout(() => {
        deleteArmed = false
        deleteGroup.classList.remove('is-confirming')
        deleteGroup.textContent = '删除分组'
      }, 4000)
      renderResult(statusArea, 'warning', '再次点击确认删除', ['该分组及其网址会被一并删除。'])
      return
    }

    window.clearTimeout(deleteArmTimer)
    deleteArmed = false
    deleteGroup.classList.remove('is-confirming')
    deleteGroup.textContent = '删除分组'

    const index = groups.findIndex((group) => group.id === activeGroupId)
    const removed = groups[index]
    groups.splice(index, 1)
    activeGroupId = groups[Math.min(index, groups.length - 1)].id
    renderAll()
    persist('delete_group')
    sendTrack('group_modified', { action: 'delete', group_count: groups.length })
    renderResult(statusArea, 'success', `已删除分组「${removed.name}」`, ['已自动切换到相邻分组。'])
  }

  addLink.addEventListener('click', () => {
    activeGroup().links.push({ url: '', enabled: true })
    persist('add')
    renderLinks()
    const inputs = linkList.querySelectorAll('.link-url')
    if (inputs.length)
      inputs[inputs.length - 1].focus()
  })

  renameGroup.addEventListener('click', startRename)
  deleteGroup.addEventListener('click', armDelete)

  openGroup.addEventListener('click', () => {
    const urls = selectedUrls()
    if (!urls.length) {
      renderResult(statusArea, 'error', '未识别到有效链接', ['请检查当前分组的网址，补全或删除无效条目后再试。'])
      return
    }

    sendTrack('open_clicked', { selected_count: urls.length, group_count: groups.length })
    if (urls.length > MAX_SUGGESTED)
      renderResult(statusArea, 'info', `正在打开 ${urls.length} 个网页…`, [`数量较多（建议单次不超过 ${MAX_SUGGESTED} 个），如浏览器变慢可分批打开。`])
    else
      renderResult(statusArea, 'info', `正在打开 ${urls.length} 个网页…`, ['请稍候，将在新标签页中打开。'])

    openTabs(urls).then((report) => {
      sendTrack('open_result', { success_count: report.opened.length, fail_count: report.failed.length })
      if (!report.failed.length) {
        renderResult(statusArea, 'success', `已打开 ${report.opened.length} 个网页`, report.opened)
      }
      else {
        renderResult(
          statusArea,
          'warning',
          `已打开 ${report.opened.length} 个，${report.failed.length} 个无法打开`,
          report.failed.map((item) => `${item.url}（${item.reason}）`),
        )
      }
    })
  })

  readStore().then((state) => {
    groups = state.groups
    activeGroupId = groups.some((group) => group.id === state.activeGroupId) ? state.activeGroupId : groups[0].id
    renderAll()
    if (state.migrated)
      return writeStore()
    return undefined
  }).then(() => {
    sendTrack('popup_open', { group_count: groups.length })
  })
})
