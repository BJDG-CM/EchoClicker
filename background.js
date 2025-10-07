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
  console.log('[DEBUG] 메시지 수신:', request.action, 'from tabId:', tabId);

  // 현재 상태 반환
  if (request.action === 'getGlobalState') {
    sendResponse({ isRecording, isAutoClicking, autoClickerTarget });
    return;
  }

  // 타겟 설정
  if (request.action === 'setAutoClickerTarget') {
    autoClickerTarget = request.target;
    broadcastStateUpdate();
    sendResponse({ status: 'success' });
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
    console.log('[DEBUG] enterSelectionMode 요청 처리 시작');
    injectAndSendMessage(tabId, { action: 'enterSelectionMode' })
      .then(response => {
        console.log('[DEBUG] enterSelectionMode 응답:', response);
        sendResponse(response);
      })
      .catch(error => {
        console.error('[DEBUG] enterSelectionMode 에러:', error);
        sendResponse({ status: 'error', message: error.message });
      });
    return true;
  }
  if (request.action === 'enterCoordinateMode') {
    console.log('[DEBUG] enterCoordinateMode 요청 처리 시작');
    injectAndSendMessage(tabId, { action: 'enterCoordinateMode' })
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ status: 'error', message: error.message }));
    return true;
  }
  if (request.action === 'coordinateSelected') {
    console.log('[DEBUG] 좌표 선택됨:', request.coordinate);
    chrome.runtime.sendMessage({ 
      action: 'coordinateSelected', 
      coordinate: request.coordinate 
    }).catch(() => {});
    sendResponse({ status: 'success' });
  }
  if (request.action === 'coordinateSelectionCancelled') {
    console.log('[DEBUG] 좌표 선택 취소됨');
    chrome.runtime.sendMessage({ action: 'coordinateSelectionCancelled' }).catch(() => {});
    sendResponse({ status: 'success' });
  }
  if (request.action === 'autoClickerTargetSelected') {
    console.log('[DEBUG] 타겟 선택됨:', request.target);
    autoClickerTarget = request.target;
    broadcastStateUpdate();
    
    // 팝업으로 메시지 전송 (Promise 에러 처리)
    chrome.runtime.sendMessage({ 
      action: 'autoClickerTargetSelected', 
      target: autoClickerTarget 
    }).catch(() => {
      // 팝업이 열려있지 않으면 무시
    });
    
    sendResponse({ status: 'success' });
    return;
  }
  if (request.action === 'selectionCancelled') {
    console.log('[DEBUG] 타겟 선택 취소됨');
    chrome.runtime.sendMessage({ action: 'selectionCancelled' }).catch(() => {
      // 팝업이 열려있지 않으면 무시
    });
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
    console.log('[DEBUG] injectAndSendMessage 시작:', tabId, message.action);
    if (!injectedTabs.has(tabId)) {
      console.log('[DEBUG] content.js 주입 중...');
      await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] });
      injectedTabs.add(tabId);
      console.log('[DEBUG] content.js 주입 완료');
    }
    const result = await chrome.tabs.sendMessage(tabId, message);
    console.log('[DEBUG] 탭 메시지 전송 완료:', result);
    return result;
  } catch (error) {
    console.error(`[DEBUG] Tab ${tabId} 통신 실패:`, error);
    return { status: 'error', message: `탭과의 통신에 실패했습니다. 페이지를 새로고침 해주세요.` };
  }
}

function broadcastStateUpdate() {
    // 팝업에 상태 변경 알림 (Promise 에러 처리)
    chrome.runtime.sendMessage({
        action: 'updateGlobalState',
        state: { isRecording, isAutoClicking, autoClickerTarget }
    }).catch(() => {
      // 팝업이 열려있지 않으면 무시
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