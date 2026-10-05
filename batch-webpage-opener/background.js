importScripts('sdk/qfa-lite.js')

const QFA_APP_ID = 'YOUR_QFA_APP_ID'

function initTracking() {
  if (typeof qfa === 'function')
    qfa('init', QFA_APP_ID)
}

function trackEvent(eventName, params) {
  if (typeof qfa === 'function')
    qfa('track_custom', eventName, params || {})
}

initTracking()

chrome.runtime.onInstalled.addListener((details) => {
  trackEvent('extension_installed', { reason: details.reason })
})

chrome.runtime.onStartup.addListener(() => {
  trackEvent('extension_startup')
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== '__track__')
    return false

  trackEvent(message.eventName, message.params)
  sendResponse({ ok: true })
  return false
})
