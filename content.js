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
    console.log('[DEBUG] 타겟 선택 모드 시작');
    if (selectionModeActive) return;
    selectionModeActive = true;
    
    // 선택 안내 메시지 표시
    showSelectionGuide();
    
    let lastTarget = null;
    
    const highlightElement = (e) => {
        if (!selectionModeActive) return;
        
        const target = e.target;
        if (target.id === 'echoclicker-guide' || target.classList.contains('echoclicker-element')) return;
        
        if (lastTarget && lastTarget !== target) {
            lastTarget.style.outline = lastTarget.originalOutline || '';
            lastTarget.style.backgroundColor = lastTarget.originalBgColor || '';
        }
        
        if (target.style) {
            target.originalOutline = target.style.outline;
            target.originalBgColor = target.style.backgroundColor;
            target.style.outline = '3px solid #ff4444';
            target.style.backgroundColor = 'rgba(255, 68, 68, 0.1)';
        }
        lastTarget = target;
    };

    const selectElement = (e) => {
        if (!selectionModeActive) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        const target = e.target;
        if (target.id === 'echoclicker-guide' || target.classList.contains('echoclicker-element')) return;
        
        console.log('[DEBUG] 요소 선택됨:', target);
        
        const selector = getCssSelector(target);
        const rect = target.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        // 스타일 복원
        if (target.style) {
            target.style.outline = target.originalOutline || '';
            target.style.backgroundColor = target.originalBgColor || '';
        }
        
        exitSelectionMode();
        
        // 선택 완료 효과
        showSelectionSuccess(target);
        
        chrome.runtime.sendMessage({
            action: 'autoClickerTargetSelected',
            target: { selector, centerX, centerY }
        });
    };
    
    const handleKeyPress = (e) => {
        if (e.key === 'Escape') {
            console.log('[DEBUG] ESC로 선택 취소');
            exitSelectionMode();
            chrome.runtime.sendMessage({ action: 'selectionCancelled' });
        }
    };
    
    document.addEventListener('mouseover', highlightElement, true);
    document.addEventListener('click', selectElement, true);
    document.addEventListener('keydown', handleKeyPress, true);
    
    // 정리 함수들을 전역에 저장
    window.echoclickerCleanup = () => {
        document.removeEventListener('mouseover', highlightElement, true);
        document.removeEventListener('click', selectElement, true);
        document.removeEventListener('keydown', handleKeyPress, true);
        if (lastTarget && lastTarget.style) {
            lastTarget.style.outline = lastTarget.originalOutline || '';
            lastTarget.style.backgroundColor = lastTarget.originalBgColor || '';
        }
    };
}

function exitSelectionMode() {
    if (!selectionModeActive) return;
    selectionModeActive = false;
    
    hideSelectionGuide();
    
    if (window.echoclickerCleanup) {
        window.echoclickerCleanup();
        delete window.echoclickerCleanup;
    }
    
    console.log('[DEBUG] 선택 모드 종료');
}

function showSelectionGuide() {
    const guide = document.createElement('div');
    guide.id = 'echoclicker-guide';
    guide.className = 'echoclicker-element';
    guide.innerHTML = `
        <div style="
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #2196F3;
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 2147483647;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 14px;
            font-weight: 500;
            pointer-events: none;
            animation: echoclicker-fade-in 0.3s ease-out;
        ">
            🎯 클릭할 요소를 선택하세요 | ESC로 취소
        </div>
    `;
    
    // 애니메이션 CSS 추가
    if (!document.getElementById('echoclicker-styles')) {
        const styles = document.createElement('style');
        styles.id = 'echoclicker-styles';
        styles.textContent = `
            @keyframes echoclicker-fade-in {
                from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
                to { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
            @keyframes echoclicker-success {
                0% { transform: scale(1); }
                50% { transform: scale(1.1); }
                100% { transform: scale(1); }
            }
        `;
        document.head.appendChild(styles);
    }
    
    document.body.appendChild(guide);
}

function hideSelectionGuide() {
    const guide = document.getElementById('echoclicker-guide');
    if (guide) guide.remove();
}

function showSelectionSuccess(element) {
    const rect = element.getBoundingClientRect();
    const success = document.createElement('div');
    success.className = 'echoclicker-element';
    success.innerHTML = `
        <div style="
            position: fixed;
            left: ${rect.left + rect.width/2}px;
            top: ${rect.top + rect.height/2}px;
            transform: translate(-50%, -50%);
            background: #4CAF50;
            color: white;
            padding: 8px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
            z-index: 2147483647;
            animation: echoclicker-success 0.6s ease-out;
            pointer-events: none;
        ">
            ✅ 선택됨
        </div>
    `;
    
    document.body.appendChild(success);
    setTimeout(() => success.remove(), 800);
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