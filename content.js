let isRecording = false;
let recordedActions = [];

// popup.js로부터 오는 메시지를 수신
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startRecording') {
    startRecording();
    sendResponse({ status: 'recording started' });
  } else if (request.action === 'stopRecording') {
    stopRecording();
    sendResponse({ actions: recordedActions });
    recordedActions = []; // 다음 녹화를 위해 초기화
  } else if (request.action === 'executeScript') {
    executeScript(request.actions).then(result => sendResponse(result));
    return true; // 비동기 응답을 위해 true 반환
  }
});

// 녹화 시작: 이벤트 리스너 등록
function startRecording() {
  if (isRecording) return;
  isRecording = true;
  recordedActions = [];
  document.addEventListener('click', handleRecordClick, true);
  document.addEventListener('change', handleRecordChange, true);
}

// 녹화 중지: 이벤트 리스너 제거
function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  document.removeEventListener('click', handleRecordClick, true);
  document.removeEventListener('change', handleRecordChange, true);
}

// 클릭 이벤트 핸들러
function handleRecordClick(e) {
  // 사용자가 확장 프로그램 UI를 클릭하는 것은 녹화에서 제외
  if (e.target.closest && e.target.closest('chrome-extension://*')) return;
  
  const selector = getCssSelector(e.target);
  const action = { type: 'click', selector };
  recordedActions.push(action);
  // popup에 실시간 업데이트 전송
  chrome.runtime.sendMessage({ action: 'updatePopup', newAction: action });
}

// 값 변경(input, textarea 등) 이벤트 핸들러
function handleRecordChange(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    const selector = getCssSelector(e.target);
    const action = { type: 'type', selector, value: e.target.value };
    recordedActions.push(action);
    chrome.runtime.sendMessage({ action: 'updatePopup', newAction: action });
  }
}

// 스크립트 실행 엔진
async function executeScript(actions) {
  const startTime = performance.now();
  try {
    for (const action of actions) {
      const element = await waitForElement(action.selector);
      if (!element) {
        throw new Error(`Element not found for selector: ${action.selector}`);
      }

      switch (action.type) {
        case 'click':
          element.click();
          break;
        case 'type':
          element.value = action.value;
          // 실제 입력처럼 보이게 하기 위해 input 이벤트 강제 발생
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        case 'wait':
          await new Promise(resolve => setTimeout(resolve, action.ms));
          break;
      }
      // 각 액션 사이에 약간의 딜레이를 주어 안정성 확보
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const endTime = performance.now();
    return { status: 'success', duration: (endTime - startTime).toFixed(0) };
  } catch (error) {
    console.error('Script execution failed:', error);
    return { status: 'error', message: error.message };
  }
}


// --- 유틸리티 함수들 ---

// 엘리먼트가 나타날 때까지 대기하는 함수 (AJAX 로딩 등 비동기 환경에 필수)
function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const element = document.querySelector(selector);
        if (element) {
            return resolve(element);
        }

        const observer = new MutationObserver(mutations => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                observer.disconnect();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Timeout waiting for element: ${selector}`));
        }, timeout);
    });
}

// 클릭된 엘리먼트의 고유한 CSS 선택자(Selector)를 생성하는 함수
// (이 부분이 자동화의 가장 핵심적이고 어려운 부분입니다)
function getCssSelector(el) {
    if (!(el instanceof Element)) return;
    const path = [];
    while (el.nodeType === Node.ELEMENT_NODE) {
        let selector = el.nodeName.toLowerCase();
        if (el.id) {
            selector += '#' + el.id;
            path.unshift(selector);
            break; // id가 있으면 더 이상 올라갈 필요 없음
        } else {
            let sib = el, nth = 1;
            while (sib = sib.previousElementSibling) {
                if (sib.nodeName.toLowerCase() == selector)
                    nth++;
            }
            if (nth != 1)
                selector += ":nth-of-type(" + nth + ")";
        }
        path.unshift(selector);
        el = el.parentNode;
    }
    return path.join(" > ");
}