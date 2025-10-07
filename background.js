let isRecording = false;
let recordedActions = [];
let currentRecordingTabId = null; // 어떤 탭에서 녹화 중인지 추적

// content.js가 주입되었는지 확인하는 Set (중복 주입 방지)
const injectedTabs = new Set();

// 메시지 리스너: popup.js와 content.js로부터의 모든 메시지를 처리
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // popup.js에서 현재 녹화 상태를 문의할 때
  if (request.action === 'getRecordingState') {
    sendResponse(isRecording);
    return true;
  }
  
  // 녹화 시작 요청
  if (request.action === 'startRecording') {
    if (isRecording) {
      sendResponse({ status: 'error', message: '이미 녹화 중입니다.' });
      return true;
    }
    isRecording = true;
    recordedActions = [];
    currentRecordingTabId = request.tabId;
    
    // content.js를 해당 탭에 주입하고 녹화 시작 명령 전달
    injectAndSendMessage(currentRecordingTabId, 'startRecording')
      .then(() => sendResponse({ status: 'success' }))
      .catch(error => {
        isRecording = false; // 에러 발생 시 녹화 상태 초기화
        sendResponse({ status: 'error', message: error.message });
      });
    return true; // 비동기 응답을 위해 true 반환
  }

  // 녹화 중지 요청
  if (request.action === 'stopRecording') {
    if (!isRecording) {
      sendResponse({ status: 'error', message: '녹화 중이 아닙니다.' });
      return true;
    }
    isRecording = false;
    
    // content.js에 녹화 중지 명령 전달
    injectAndSendMessage(currentRecordingTabId, 'stopRecording')
      .then(() => {
        sendResponse({ status: 'success', actions: recordedActions });
        recordedActions = []; // 저장 후 초기화
        currentRecordingTabId = null;
      })
      .catch(error => {
        sendResponse({ status: 'error', message: error.message });
      });
    return true;
  }

  // content.js로부터 녹화된 액션을 수신
  if (request.action === 'recordAction' && sender.tab.id === currentRecordingTabId && isRecording) {
    recordedActions.push(request.newAction);
    // 팝업이 열려있다면 실시간 업데이트 메시지 전송
    chrome.runtime.sendMessage({ action: 'updatePopupEditor', newAction: request.newAction });
  }

  // 스크립트 실행 요청
  if (request.action === 'executeScript') {
    const { tabId, actions } = request;
    
    // content.js를 해당 탭에 주입하고 스크립트 실행 명령 전달
    injectAndSendMessage(tabId, 'executeScript', { actions })
      .then(result => sendResponse(result)) // content.js의 실행 결과를 popup.js로 전달
      .catch(error => sendResponse({ status: 'error', message: error.message }));
    return true;
  }
});

// 탭이 업데이트되거나 닫힐 때 녹화 상태 초기화
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId === currentRecordingTabId && changeInfo.status === 'loading') {
    // 녹화 중인 탭이 새로고침되면 녹화 중지
    if (isRecording) {
      console.log(`Recording stopped due to tab ${tabId} navigation.`);
      isRecording = false;
      recordedActions = [];
      currentRecordingTabId = null;
      // 팝업 UI에도 업데이트 알림
      chrome.runtime.sendMessage({ action: 'updatePopupUI', isRecording: false });
    }
    injectedTabs.delete(tabId); // 탭이 새로 로드되면 content.js 재주입 필요
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentRecordingTabId) {
    // 녹화 중인 탭이 닫히면 녹화 중지
    console.log(`Recording stopped due to tab ${tabId} closed.`);
    isRecording = false;
    recordedActions = [];
    currentRecordingTabId = null;
    chrome.runtime.sendMessage({ action: 'updatePopupUI', isRecording: false });
  }
  injectedTabs.delete(tabId);
});


// content.js를 탭에 주입하고 메시지를 보내는 헬퍼 함수
async function injectAndSendMessage(tabId, action, data = {}) {
  try {
    // content.js가 아직 주입되지 않았다면 주입
    if (!injectedTabs.has(tabId)) {
        console.log(`Injecting content.js into tab ${tabId}`);
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        });
        injectedTabs.add(tabId);
    }
    
    // content.js로 메시지 전송
    const response = await chrome.tabs.sendMessage(tabId, { action, ...data });
    return response;
  } catch (error) {
    console.error(`Failed to inject/send message to tab ${tabId}:`, error);
    throw new Error(`탭 (${tabId})과의 통신 실패: ${error.message}`);
  }
}

// Background Script에서도 parseCodeToActions 함수가 필요할 수 있으므로,
// 유틸리티 파일로 분리하는 것이 좋습니다. 여기서는 예시를 위해 간략히 포함.
function parseCodeToActions(code) {
  // popup.js에 있는 parseCodeToActions와 동일한 로직
  // 또는 util.js 같은 별도 파일로 분리하여 양쪽에서 import
  return []; 
}