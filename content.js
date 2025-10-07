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
    if (selectionModeActive) return;
    selectionModeActive = true;
    
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.zIndex = '99999999';
    overlay.style.backgroundColor = 'rgba(0, 123, 255, 0.1)';
    overlay.style.cursor = 'crosshair';
    document.body.appendChild(overlay);

    let lastTarget = null;
    const highlightElement = (e) => {
        const target = e.target;
        if (target === overlay || target === lastTarget) return;
        if (lastTarget) lastTarget.style.outline = '';
        target.style.outline = '2px solid red';
        lastTarget = target;
    };

    const selectElement = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const target = e.target;
        if (target === overlay) return;

        target.style.outline = '';
        const selector = getCssSelector(target);
        const rect = target.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        chrome.runtime.sendMessage({
            action: 'autoClickerTargetSelected',
            target: { selector, centerX, centerY }
        });
        
        exitSelectionMode(overlay);
    };
    
    overlay.addEventListener('mouseover', highlightElement);
    overlay.addEventListener('click', selectElement);

    const exitSelectionMode = (overlayElement) => {
        if (!selectionModeActive) return;
        selectionModeActive = false;
        if (lastTarget) lastTarget.style.outline = '';
        overlayElement.removeEventListener('mouseover', highlightElement);
        overlayElement.removeEventListener('click', selectElement);
        document.body.removeChild(overlayElement);
    };
}


// --- 오토클리커 로직 ---
function startAutoClicker(options) {
    if (autoClickerInterval) stopAutoClicker();

    const { target, radius, minInterval, maxInterval, duration } = options;
    autoClickerEndTime = Date.now() + duration;

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
    // ... (이전 답변의 executeScript 함수와 동일, 여기서는 생략) ...
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