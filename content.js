// content.js는 더 이상 자체적으로 isRecording 상태를 관리하지 않음
let currentListeners = []; // 등록된 이벤트 리스너 추적

// popup.js나 background.js로부터 오는 메시지를 수신
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startRecording') {
    startRecordingListeners();
    sendResponse({ status: 'success' });
  } else if (request.action === 'stopRecording') {
    stopRecordingListeners();
    sendResponse({ status: 'success' });
  } else if (request.action === 'executeScript') {
    executeScript(request.actions).then(result => sendResponse(result));
    return true; // 비동기 응답을 위해 true 반환
  }
});

// 녹화 시작: 이벤트 리스너 등록
function startRecordingListeners() {
  if (currentListeners.length > 0) return; // 이미 리스너가 있다면 중복 등록 방지

  const handleClick = (e) => handleRecordEvent(e, 'click');
  const handleChange = (e) => handleRecordEvent(e, 'change');

  document.addEventListener('click', handleClick, true);
  document.addEventListener('change', handleChange, true);
  
  currentListeners.push({ event: 'click', handler: handleClick, capture: true });
  currentListeners.push({ event: 'change', handler: handleChange, capture: true });
}

// 녹화 중지: 이벤트 리스너 제거
function stopRecordingListeners() {
  currentListeners.forEach(({ event, handler, capture }) => {
    document.removeEventListener(event, handler, capture);
  });
  currentListeners = [];
}

// 이벤트 핸들러에서 액션을 background.js로 전달
function handleRecordEvent(e, eventType) {
  // 크롬 확장 프로그램 내부 요소를 클릭하는 것은 녹화에서 제외
  if (e.target.closest && e.target.closest('chrome-extension://*')) return;
  
  const selector = getCssSelector(e.target);
  let action = null;

  if (eventType === 'click') {
    action = { type: 'click', selector };
  } else if (eventType === 'change') {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
      action = { type: 'type', selector, value: e.target.value };
    }
  }

  if (action) {
    // 녹화된 액션을 즉시 background.js로 전송
    chrome.runtime.sendMessage({ action: 'recordAction', newAction: action });
  }
}

// executeScript, waitForElement, getCssSelector 함수는 동일하게 유지됩니다.
// (단, getCssSelector는 더 정교하게 개선될 수 있음)

// 엘리먼트가 나타날 때까지 대기하는 함수 (동일)
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

        const timer = setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Timeout waiting for element: ${selector}`));
        }, timeout);
    });
}

// 클릭된 엘리먼트의 고유한 CSS 선택자(Selector)를 생성하는 함수 (동일)
function getCssSelector(el) {
    if (!(el instanceof Element)) return;
    const path = [];
    while (el.nodeType === Node.ELEMENT_NODE) {
        let selector = el.nodeName.toLowerCase();
        if (el.id) {
            selector += '#' + el.id;
            path.unshift(selector);
            break; 
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