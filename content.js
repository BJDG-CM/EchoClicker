// --- 상태 변수 ---
let currentListeners = []; // 녹화 리스너 추적
let selectionModeActive = false; // 타겟 선택 모드 활성화 여부
let autoClickerInterval = null; // 오토클리커 인터벌 ID
let autoClickerEndTime = null;

// --- 메시지 리스너 ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startRecording') {
    startRecordingListeners();
    sendResponse({ status: 'success' });
  } else if (request.action === 'stopRecording') {
    stopRecordingListeners();
    sendResponse({ status: 'success' });
  } else if (request.action === 'executeScript') {
    executeScript(request.actions).then(result => sendResponse(result));
    return true; // 비동기 응답
  } else if (request.action === 'enterSelectionMode') {
    enterSelectionMode();
    sendResponse({ status: 'success' });
  } else if (request.action === 'startAutoClicker') {
    startAutoClicker(request.options);
    sendResponse({ status: 'success' });
  } else if (request.action === 'stopAutoClicker') {
    stopAutoClicker();
    sendResponse({ status: 'success' });
  }
});


// --- 타겟 선택 모드 ---
function enterSelectionMode() {
    console.log('[DEBUG] enterSelectionMode 시작');
    if (selectionModeActive) {
        console.log('[DEBUG] 이미 선택 모드가 활성화됨');
        return;
    }
    selectionModeActive = true;
    
    const overlay = document.createElement('div');
    overlay.id = 'echoclicker-selection-overlay';
    overlay.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        z-index: 2147483647 !important;
        background-color: rgba(0, 123, 255, 0.1) !important;
        cursor: crosshair !important;
        pointer-events: auto !important;
    `;
    document.body.appendChild(overlay);
    console.log('[DEBUG] 오버레이 생성 완료');

    let lastTarget = null;
    
    const highlightElement = (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // 오버레이 아래의 실제 요소 찾기
        overlay.style.pointerEvents = 'none';
        const actualTarget = document.elementFromPoint(e.clientX, e.clientY);
        overlay.style.pointerEvents = 'auto';
        
        if (!actualTarget || actualTarget === overlay || actualTarget === lastTarget) return;
        
        if (lastTarget && lastTarget.style) {
            lastTarget.style.outline = lastTarget.originalOutline || '';
        }
        
        if (actualTarget.style) {
            actualTarget.originalOutline = actualTarget.style.outline;
            actualTarget.style.outline = '3px solid #ff0000 !important';
        }
        lastTarget = actualTarget;
        
        console.log('[DEBUG] 하이라이트된 요소:', actualTarget.tagName, actualTarget.className);
    };

    const selectElement = (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        console.log('[DEBUG] selectElement 호출됨');
        
        // 오버레이 아래의 실제 요소 찾기
        overlay.style.pointerEvents = 'none';
        const actualTarget = document.elementFromPoint(e.clientX, e.clientY);
        overlay.style.pointerEvents = 'auto';

        if (!actualTarget || actualTarget === overlay) {
            console.log('[DEBUG] 유효하지 않은 타겟');
            return;
        }

        console.log('[DEBUG] 선택된 요소:', actualTarget.tagName, actualTarget.className);

        // 스타일 복원
        if (actualTarget.style) {
            actualTarget.style.outline = actualTarget.originalOutline || '';
        }
        
        const selector = getCssSelector(actualTarget);
        const rect = actualTarget.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        console.log('[DEBUG] 타겟 정보:', { selector, centerX, centerY });

        chrome.runtime.sendMessage({
            action: 'autoClickerTargetSelected',
            target: { selector, centerX, centerY }
        }, (response) => {
            console.log('[DEBUG] 타겟 선택 메시지 응답:', response);
        });
        
        exitSelectionMode(overlay);
    };
    
    overlay.addEventListener('mousemove', highlightElement, true);
    overlay.addEventListener('click', selectElement, true);
    
    // ESC 키로 선택 모드 종료
    const handleKeyPress = (e) => {
        if (e.key === 'Escape') {
            console.log('[DEBUG] ESC로 선택 모드 종료');
            exitSelectionMode(overlay);
        }
    };
    document.addEventListener('keydown', handleKeyPress);

    const exitSelectionMode = (overlayElement) => {
        console.log('[DEBUG] exitSelectionMode 호출됨');
        if (!selectionModeActive) return;
        selectionModeActive = false;
        
        if (lastTarget && lastTarget.style) {
            lastTarget.style.outline = lastTarget.originalOutline || '';
        }
        
        overlayElement.removeEventListener('mousemove', highlightElement, true);
        overlayElement.removeEventListener('click', selectElement, true);
        document.removeEventListener('keydown', handleKeyPress);
        
        if (overlayElement.parentNode) {
            overlayElement.parentNode.removeChild(overlayElement);
        }
        console.log('[DEBUG] 선택 모드 종료 완료');
    };
}


// --- 오토클리커 로직 ---
function startAutoClicker(options) {
    if (autoClickerInterval) stopAutoClicker();

    const { target, radius, minInterval, maxInterval, duration } = options;
    autoClickerEndTime = Date.now() + duration;

    // 오토클리커 시작 상태를 background에 알림
    chrome.runtime.sendMessage({ action: 'autoClickerStateChanged', isAutoClicking: true });

    const clickFunction = () => {
        if (Date.now() >= autoClickerEndTime) {
            stopAutoClicker();
            return;
        }

        const angle = Math.random() * 2 * Math.PI;
        const r = Math.random() * radius;
        const targetX = target.centerX + r * Math.cos(angle);
        const targetY = target.centerY + r * Math.sin(angle);
        const element = document.elementFromPoint(targetX, targetY);

        if (element) {
            const event = new MouseEvent('click', { view: window, bubbles: true, cancelable: true, clientX: targetX, clientY: targetY });
            element.dispatchEvent(event);
        }

        const nextInterval = Math.random() * (maxInterval - minInterval) + minInterval;
        autoClickerInterval = setTimeout(clickFunction, nextInterval);
    };

    clickFunction(); // 첫 클릭은 즉시 시작
}

function stopAutoClicker() {
    if (autoClickerInterval) {
        clearTimeout(autoClickerInterval);
        autoClickerInterval = null;
        autoClickerEndTime = null;
        chrome.runtime.sendMessage({ action: 'autoClickerStateChanged', isAutoClicking: false });
    }
}


// --- 매크로 녹화 로직 ---
function startRecordingListeners() {
  if (currentListeners.length > 0) return;
  const handleClick = (e) => handleRecordEvent(e, 'click');
  const handleChange = (e) => handleRecordEvent(e, 'change');
  document.addEventListener('click', handleClick, true);
  document.addEventListener('change', handleChange, true);
  currentListeners.push({ event: 'click', handler: handleClick, capture: true });
  currentListeners.push({ event: 'change', handler: handleChange, capture: true });
}

function stopRecordingListeners() {
  currentListeners.forEach(({ event, handler, capture }) => {
    document.removeEventListener(event, handler, capture);
  });
  currentListeners = [];
}

function handleRecordEvent(e, eventType) {
  if (selectionModeActive) return; // 타겟 선택 모드일때는 녹화하지 않음
  if (e.target.closest && e.target.closest('chrome-extension://*')) return;
  const selector = getCssSelector(e.target);
  let action = null;
  if (eventType === 'click') {
    action = { type: 'click', selector };
  } else if (eventType === 'change' && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) {
    action = { type: 'type', selector, value: e.target.value };
  }
  if (action) {
    chrome.runtime.sendMessage({ action: 'recordAction', newAction: action });
  }
}

// --- 스크립트 실행 엔진 ---
async function executeScript(actions) {
  try {
    for (const action of actions) {
      if (action.type === 'click') {
        const element = document.querySelector(action.selector);
        if (element) {
          element.click();
        } else {
          console.warn(`요소를 찾을 수 없습니다: ${action.selector}`);
        }
      } else if (action.type === 'type') {
        const element = document.querySelector(action.selector);
        if (element) {
          element.value = action.value;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          console.warn(`요소를 찾을 수 없습니다: ${action.selector}`);
        }
      } else if (action.type === 'wait') {
        await new Promise(resolve => setTimeout(resolve, action.ms));
      }
    }
    return { status: 'success' };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}

// --- 유틸리티 함수 ---
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
                if (sib.nodeName.toLowerCase() == selector) nth++;
            }
            if (nth != 1) selector += `:nth-of-type(${nth})`;
        }
        path.unshift(selector);
        el = el.parentNode;
    }
    return path.join(" > ");
}