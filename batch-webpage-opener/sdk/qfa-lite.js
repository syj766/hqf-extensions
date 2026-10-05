;(function (global) {
  var REPORT_URL = 'https://tracking.zbrowser.cn/api/wdd'
  var STORAGE_KEY = 'simple_qfa_device_id'
  var state = {
    appId: '',
    deviceId: '',
    ready: false,
    queue: [],
  }

  function randomId() {
    var seed = [
      typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent : 'extension',
      Date.now(),
      Math.random(),
    ].join('|')
    var hash = 0
    for (var i = 0; i < seed.length; i += 1)
      hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
    return hash.toString(16).padStart(8, '0') + Date.now().toString(16).slice(-8)
  }

  function getDeviceId(callback) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      callback(randomId())
      return
    }

    chrome.storage.local.get(STORAGE_KEY, function (items) {
      if (items && items[STORAGE_KEY]) {
        callback(items[STORAGE_KEY])
        return
      }

      var id = randomId()
      chrome.storage.local.set({ [STORAGE_KEY]: id }, function () {
        callback(id)
      })
    })
  }

  function buildQuery(params) {
    return Object.keys(params).map(function (key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(
        typeof params[key] === 'string' ? params[key] : JSON.stringify(params[key]),
      )
    }).join('&')
  }

  function flush() {
    while (state.queue.length) {
      var item = state.queue.shift()
      trackCustom(item.eventName, item.params)
    }
  }

  function init(appId) {
    state.appId = appId
    getDeviceId(function (deviceId) {
      state.deviceId = deviceId
      state.ready = Boolean(state.appId)
      flush()
    })
  }

  function trackCustom(eventName, params) {
    if (!state.ready) {
      state.queue.push({ eventName: eventName, params: params || {} })
      return
    }

    var timestamp = Date.now()
    var body = {
      body: [{
        event_count: 1,
        event_data: params || {},
        event_duration: 0,
        event_id: eventName,
        event_type: 'custome_event',
        timestamp: timestamp,
      }],
      header: {
        app_channel: 'zero',
        app_id: state.appId,
        device_id: state.deviceId,
        device_info: { from: 'background' },
        platform: typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent : 'extension',
        screen_size: '0x0',
        timestamp: timestamp,
        timezone: 'GMT+8',
      },
    }

    var query = buildQuery({ id: state.appId, body: body, t: timestamp })
    fetch(REPORT_URL + '?' + query, { mode: 'no-cors', keepalive: true }).catch(function () {})
  }

  global.qfa = function qfa(method) {
    if (method === 'init') {
      init(arguments[1])
      return
    }
    if (method === 'track_custom')
      trackCustom(arguments[1], arguments[2])
  }
})(typeof self !== 'undefined' ? self : this)
