// --- 전역 상태 관리 ---
let isRecording = false;
let recordedActions = [];
let currentRecordingTabId = null;

let isAutoClicking = false;
let autoClickerTarget = null;
let currentAutoClickerTabId = null;

const injectedTabs = new Set();

// --- 메시지 라우팅 ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const tabId = request.tabId || (sender.tab ? sender.tab.id : null);

  // 현재 상태 반환
  if (request.action === 'getGlobalState') {
    sendResponse({ isRecording, isAutoClicking, autoClickerTarget });
    return;
  }

  // 매크로 녹화
  if (request.action === 'startRecording') {
    startRecording(tabId).then(response => sendResponse(response));
    return true;
  }
  if (request.action === 'stopRecording') {
    stopRecording(tabId).then(response => sendResponse(response));
    return true;
  }
  if (request.action === 'recordAction' && sender.tab.id === currentRecordingTabId) {
    recordedActions.push(request.newAction);
    chrome.runtime.sendMessage({ action: 'updatePopupEditor', newAction: request.newAction });
  }

  // 스크립트 실행
  if (request.action === 'executeScript') {
    executeScript(tabId, request.actions).then(response => sendResponse(response));
    return true;
  }

  // 오토클리커
  if (request.action === 'enterSelectionMode') {
    injectAndSendMessage(tabId, { action: 'enterSelectionMode' })
      .then(response => sendResponse(response));
    return true;
  }
  if (request.action === 'autoClickerTargetSelected') {
    autoClickerTarget = request.target;
    // 상태 업데이트를 브로드캐스트하여 팝업 UI 동기화
    broadcastStateUpdate();
    // 열려있는 팝업에 타겟 정보 전달
    chrome.runtime.sendMessage({ action: 'autoClickerTargetSelected', target: autoClickerTarget });
    sendResponse({ status: 'success' });
  }
  if (request.action === 'startAutoClicker') {
    startAutoClicker(tabId, request.options).then(response => sendResponse(response));
    return true;
  }
  if (request.action === 'stopAutoClicker') {
    stopAutoClicker().then(response => sendResponse(response));
    return true;
  }
  if (request.action === 'autoClickerStateChanged') {
      isAutoClicking = request.isAutoClicking;
      if (!isAutoClicking) currentAutoClickerTabId = null;
      broadcastStateUpdate();
  }
});


// --- 핸들러 함수 구현 ---
async function startRecording(tabId) {
  if (isRecording) return { status: 'error', message: '이미 녹화 중입니다.' };
  isRecording = true;
  recordedActions = [];
  currentRecordingTabId = tabId;
  broadcastStateUpdate();
  await injectAndSendMessage(tabId, { action: 'startRecording' });
  return { status: 'success' };
}

async function stopRecording(tabId) {
  if (!isRecording) return { status: 'error', message: '녹화 중이 아닙니다.' };
  isRecording = false;
  currentRecordingTabId = null;
  broadcastStateUpdate();
  await injectAndSendMessage(tabId, { action: 'stopRecording' });
  return { status: 'success', actions: recordedActions };
}

async function executeScript(tabId, actions) {
  return await injectAndSendMessage(tabId, { action: 'executeScript', actions });
}

async function startAutoClicker(tabId, options) {
    if (isAutoClicking) return { status: 'error', message: '이미 오토클리커가 실행 중입니다.' };
    isAutoClicking = true;
    currentAutoClickerTabId = tabId;
    broadcastStateUpdate();
    const result = await injectAndSendMessage(tabId, { action: 'startAutoClicker', options });
    // content.js에서 오토클리커 시작 성공 시 상태 메시지 전송하도록 수정
    if (result.status === 'success') {
        chrome.runtime.sendMessage({ action: 'autoClickerStateChanged', isAutoClicking: true });
    }
    return result;
}

async function stopAutoClicker() {
    if (!isAutoClicking || !currentAutoClickerTabId) return { status: 'error', message: '실행 중인 오토클리커가 없습니다.'};
    await injectAndSendMessage(currentAutoClickerTabId, { action: 'stopAutoClicker' });
    isAutoClicking = false;
    currentAutoClickerTabId = null;
    broadcastStateUpdate();
    return { status: 'success' };
}


// --- 헬퍼 함수 ---
async function injectAndSendMessage(tabId, message) {
  try {
    if (!injectedTabs.has(tabId)) {
      await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] });
      injectedTabs.add(tabId);
    }
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    console.error(`Tab ${tabId} 통신 실패:`, error);
    return { status: 'error', message: `탭과의 통신에 실패했습니다. 페이지를 새로고침 해주세요.` };
  }
}

function broadcastStateUpdate() {
    // 모든 팝업(만약 열려있다면)에 상태 변경 알림
    chrome.runtime.sendMessage({
        action: 'updateGlobalState',
        state: { isRecording, isAutoClicking, autoClickerTarget }
    });
}

// 탭 정리
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentRecordingTabId) {
    isRecording = false;
    currentRecordingTabId = null;
  }
  if (tabId === currentAutoClickerTabId) {
      isAutoClicking = false;
      currentAutoClickerTabId = null;
  }
  injectedTabs.delete(tabId);
});