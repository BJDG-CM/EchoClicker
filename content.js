// --- 상태 변수 ---
let currentListeners = []; // 녹화 리스너 추적
let selectionModeActive = false; // 타겟 선택 모드 활성화 여부
let autoClickerInterval = null; // 오토클리커 인터벌 ID
let autoClickerEndTime = null;
let selectionListeners = []; // 선택 모드 리스너들

// --- 메시지 리스너 ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[CONTENT] 메시지 수신:', request.action);
  
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
    console.log('[CONTENT] enterSelectionMode 시작');
    const result = enterSelectionMode();
    sendResponse({ status: result ? 'success' : 'error', message: result ? '' : '선택 모드 시작 실패' });
  } else if (request.action === 'startAutoClicker') {
    startAutoClicker(request.options);
    sendResponse({ status: 'success' });
  } else if (request.action === 'stopAutoClicker') {
    stopAutoClicker();
    sendResponse({ status: 'success' });
  } else if (request.action === 'enterCoordinateMode') {
    console.log('[CONTENT] enterCoordinateMode 시작');
    const result = enterCoordinateMode();
    sendResponse({ status: result ? 'success' : 'error', message: result ? '' : '좌표 선택 모드 시작 실패' });
  }
});

// --- 타겟 선택 모드 ---
function enterSelectionMode() {
    console.log('[CONTENT] enterSelectionMode 호출됨, 현재 상태:', selectionModeActive);
    
    if (selectionModeActive) {
        console.log('[CONTENT] 이미 선택 모드가 활성화됨');
        return false;
    }
    
    try {
        selectionModeActive = true;
        console.log('[CONTENT] 선택 모드 활성화');
        
        // 기존 가이드 제거
        removeSelectionGuide();
        
        // 선택 가이드 생성
        createSelectionGuide();
        
        let lastHighlighted = null;
        
        // 마우스오버 핸들러
        const mouseOverHandler = (e) => {
            if (!selectionModeActive) return;
            e.stopPropagation();
            
            const target = e.target;
            
            // 가이드 요소들은 제외
            if (target.classList.contains('echoclicker-guide') || 
                target.closest('.echoclicker-guide')) {
                return;
            }
            
            // 이전 하이라이트 제거
            if (lastHighlighted && lastHighlighted !== target) {
                removeHighlight(lastHighlighted);
            }
            
            // 새 요소 하이라이트
            addHighlight(target);
            lastHighlighted = target;
            
            console.log('[CONTENT] 하이라이트:', target.tagName, target.className);
        };
        
        // 클릭 핸들러
        const clickHandler = (e) => {
            if (!selectionModeActive) return;
            
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            const target = e.target;
            
            // 가이드 요소들은 제외
            if (target.classList.contains('echoclicker-guide') || 
                target.closest('.echoclicker-guide')) {
                return;
            }
            
            console.log('[CONTENT] 요소 클릭됨:', target.tagName, target.className);
            
            // 선택 모드 종료
            exitSelectionMode();
            
            // 타겟 정보 생성
            const selector = getCssSelector(target);
            const rect = target.getBoundingClientRect();
            const targetInfo = {
                selector: selector,
                centerX: Math.round(rect.left + rect.width / 2 + window.scrollX),
                centerY: Math.round(rect.top + rect.height / 2 + window.scrollY)
            };
            
            console.log('[CONTENT] 타겟 정보:', targetInfo);
            
            // 성공 메시지 표시
            showSuccessMessage(target);
            
            // 백그라운드에 타겟 선택 완료 알림
            chrome.runtime.sendMessage({
                action: 'autoClickerTargetSelected',
                target: targetInfo
            }).catch((error) => {
                console.log('[CONTENT] 메시지 전송 실패:', error.message);
            });
            
            return false;
        };
        
        // ESC 키 핸들러
        const keyHandler = (e) => {
            if (e.key === 'Escape') {
                console.log('[CONTENT] ESC로 선택 취소');
                exitSelectionMode();
                chrome.runtime.sendMessage({ action: 'selectionCancelled' }).catch(() => {
                    // 에러 무시
                });
            }
        };
        
        // 이벤트 리스너 등록
        document.addEventListener('mouseover', mouseOverHandler, true);
        document.addEventListener('click', clickHandler, true);
        document.addEventListener('keydown', keyHandler, true);
        
        // 리스너 추적용
        selectionListeners = [
            { type: 'mouseover', handler: mouseOverHandler },
            { type: 'click', handler: clickHandler },
            { type: 'keydown', handler: keyHandler }
        ];
        
        console.log('[CONTENT] 이벤트 리스너 등록 완료');
        return true;
        
    } catch (error) {
        console.error('[CONTENT] enterSelectionMode 에러:', error);
        selectionModeActive = false;
        return false;
    }
}

function exitSelectionMode() {
    if (!selectionModeActive) return;
    
    console.log('[CONTENT] 선택 모드 종료');
    selectionModeActive = false;
    
    // 이벤트 리스너 제거
    selectionListeners.forEach(listener => {
        document.removeEventListener(listener.type, listener.handler, true);
    });
    selectionListeners = [];
    
    // 가이드 제거
    removeSelectionGuide();
    
    // 모든 하이라이트 제거
    document.querySelectorAll('.echoclicker-highlighted').forEach(el => {
        removeHighlight(el);
    });
}

function createSelectionGuide() {
    const guide = document.createElement('div');
    guide.className = 'echoclicker-guide';
    guide.innerHTML = `
        <div style="
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 15px 25px;
            border-radius: 12px;
            box-shadow: 0 8px 25px rgba(0,0,0,0.3);
            z-index: 2147483647;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 16px;
            font-weight: 600;
            text-align: center;
            pointer-events: none;
            user-select: none;
            border: 2px solid rgba(255,255,255,0.2);
        ">
            🎯 클릭할 요소를 선택하세요<br>
            <small style="font-size: 12px; opacity: 0.9;">ESC 키로 취소</small>
        </div>
    `;
    document.body.appendChild(guide);
}

function removeSelectionGuide() {
    const existingGuide = document.querySelector('.echoclicker-guide');
    if (existingGuide) {
        existingGuide.remove();
    }
}

function addHighlight(element) {
    element.classList.add('echoclicker-highlighted');
    element.style.outline = '3px solid #ff4444';
    element.style.outlineOffset = '2px';
    element.style.backgroundColor = 'rgba(255, 68, 68, 0.1)';
    element.style.transition = 'all 0.2s ease';
}

function removeHighlight(element) {
    if (element && element.classList) {
        element.classList.remove('echoclicker-highlighted');
        element.style.outline = '';
        element.style.outlineOffset = '';
        element.style.backgroundColor = '';
        element.style.transition = '';
    }
}

function showSuccessMessage(element) {
    const rect = element.getBoundingClientRect();
    const success = document.createElement('div');
    success.className = 'echoclicker-success';
    success.innerHTML = `
        <div style="
            position: fixed;
            left: ${rect.left + rect.width/2}px;
            top: ${rect.top + rect.height/2}px;
            transform: translate(-50%, -50%);
            background: #4CAF50;
            color: white;
            padding: 10px 15px;
            border-radius: 25px;
            font-size: 14px;
            font-weight: bold;
            z-index: 2147483647;
            box-shadow: 0 4px 15px rgba(76, 175, 80, 0.4);
            pointer-events: none;
            animation: echoclicker-bounce 0.6s ease-out;
        ">
            ✅ 타겟 선택됨!
        </div>
    `;
    
    // 애니메이션 CSS 추가
    if (!document.getElementById('echoclicker-animations')) {
        const style = document.createElement('style');
        style.id = 'echoclicker-animations';
        style.textContent = `
            @keyframes echoclicker-bounce {
                0% { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
                50% { transform: translate(-50%, -50%) scale(1.1); opacity: 1; }
                100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }
    
    document.body.appendChild(success);
    setTimeout(() => success.remove(), 1500);
}

// --- 좌표 선택 모드 ---
function enterCoordinateMode() {
    console.log('[CONTENT] enterCoordinateMode 호출됨');
    
    if (selectionModeActive) {
        console.log('[CONTENT] 이미 선택 모드가 활성화됨');
        exitSelectionMode();
    }
    
    try {
        selectionModeActive = true;
        console.log('[CONTENT] 좌표 선택 모드 활성화');
        
        // 기존 가이드 제거
        removeSelectionGuide();
        
        // 좌표 선택 가이드 생성
        createCoordinateGuide();
        
        // 마우스 이동 시 좌표 표시
        const mouseMoveHandler = (e) => {
            if (!selectionModeActive) return;
            updateCoordinateDisplay(e.clientX + window.scrollX, e.clientY + window.scrollY);
        };
        
        // 클릭 핸들러 - 더 강력하게 수정
        const clickHandler = (e) => {
            console.log('[CONTENT] 클릭 이벤트 감지됨');
            
            if (!selectionModeActive) {
                console.log('[CONTENT] 선택 모드가 비활성화됨');
                return;
            }
            
            // 모든 기본 동작 차단
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            // 가이드 요소들은 제외
            if (e.target.classList.contains('echoclicker-guide') || 
                e.target.closest('.echoclicker-guide') ||
                e.target.classList.contains('echoclicker-coordinate-display')) {
                console.log('[CONTENT] 가이드 요소 클릭 - 무시');
                return;
            }
            
            // 페이지 좌표 계산 (스크롤 포함)
            const pageX = Math.round(e.clientX + window.scrollX);
            const pageY = Math.round(e.clientY + window.scrollY);
            
            console.log('[CONTENT] 좌표 클릭됨 - 클라이언트:', e.clientX, e.clientY, '페이지:', pageX, pageY);
            
            // 선택 모드 종료
            exitCoordinateMode();
            
            // 성공 메시지 표시
            showCoordinateSuccess(e.clientX, e.clientY, pageX, pageY);
            
            // 백그라운드에 좌표 선택 완료 알림
            chrome.runtime.sendMessage({
                action: 'coordinateSelected',
                coordinate: { x: pageX, y: pageY }
            }).then(() => {
                console.log('[CONTENT] 좌표 선택 메시지 전송 완료');
            }).catch((error) => {
                console.log('[CONTENT] 메시지 전송 실패:', error.message);
            });
            
            return false;
        };
        
        // ESC 키 핸들러
        const keyHandler = (e) => {
            if (e.key === 'Escape') {
                console.log('[CONTENT] ESC로 좌표 선택 취소');
                exitCoordinateMode();
                chrome.runtime.sendMessage({ action: 'coordinateSelectionCancelled' }).catch(() => {});
            }
        };
        
        // 이벤트 리스너 등록 - capture phase에서 최우선 처리
        document.addEventListener('mousemove', mouseMoveHandler, true);
        document.addEventListener('click', clickHandler, true);
        document.addEventListener('keydown', keyHandler, true);
        
        // 다른 모든 클릭 이벤트를 차단하는 오버레이 생성
        createCoordinateOverlay(clickHandler);
        
        // 리스너 추적용
        selectionListeners = [
            { type: 'mousemove', handler: mouseMoveHandler },
            { type: 'click', handler: clickHandler },
            { type: 'keydown', handler: keyHandler }
        ];
        
        console.log('[CONTENT] 좌표 선택 이벤트 리스너 등록 완료');
        return true;
        
    } catch (error) {
        console.error('[CONTENT] enterCoordinateMode 에러:', error);
        selectionModeActive = false;
        return false;
    }
}

function exitCoordinateMode() {
    if (!selectionModeActive) return;
    
    console.log('[CONTENT] 좌표 선택 모드 종료');
    selectionModeActive = false;
    
    // 이벤트 리스너 제거
    selectionListeners.forEach(listener => {
        document.removeEventListener(listener.type, listener.handler, true);
    });
    selectionListeners = [];
    
    // 가이드 및 오버레이 제거
    removeSelectionGuide();
    removeCoordinateOverlay();
    removeCoordinateDisplay();
}

function createCoordinateOverlay(clickHandler) {
    const overlay = document.createElement('div');
    overlay.id = 'echoclicker-coordinate-overlay';
    overlay.className = 'echoclicker-guide';
    overlay.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        z-index: 2147483646 !important;
        background: transparent !important;
        cursor: crosshair !important;
        pointer-events: auto !important;
    `;
    
    // 오버레이에도 클릭 핸들러 추가
    overlay.addEventListener('click', clickHandler, true);
    
    document.body.appendChild(overlay);
}

function removeCoordinateOverlay() {
    const overlay = document.getElementById('echoclicker-coordinate-overlay');
    if (overlay) overlay.remove();
}

function createCoordinateGuide() {
    const guide = document.createElement('div');
    guide.className = 'echoclicker-guide';
    guide.id = 'echoclicker-coordinate-guide';
    guide.innerHTML = `
        <div style="
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, #FF6B6B 0%, #FF8E53 100%);
            color: white;
            padding: 15px 25px;
            border-radius: 12px;
            box-shadow: 0 8px 25px rgba(0,0,0,0.3);
            z-index: 2147483647;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 16px;
            font-weight: 600;
            text-align: center;
            pointer-events: none;
            user-select: none;
            border: 2px solid rgba(255,255,255,0.2);
        ">
            📍 클릭할 좌표를 선택하세요<br>
            <small style="font-size: 12px; opacity: 0.9;">ESC 키로 취소</small>
        </div>
    `;
    document.body.appendChild(guide);
}

function updateCoordinateDisplay(x, y) {
    let display = document.getElementById('echoclicker-coordinate-display');
    if (!display) {
        display = document.createElement('div');
        display.id = 'echoclicker-coordinate-display';
        display.className = 'echoclicker-guide echoclicker-coordinate-display';
        document.body.appendChild(display);
    }
    
    display.style.cssText = `
        position: fixed !important;
        top: 60px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        background: rgba(0,0,0,0.8) !important;
        color: white !important;
        padding: 8px 15px !important;
        border-radius: 6px !important;
        font-family: monospace !important;
        font-size: 14px !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
        user-select: none !important;
    `;
    display.textContent = `좌표: (${x}, ${y})`;
}

function removeCoordinateDisplay() {
    const display = document.getElementById('echoclicker-coordinate-display');
    if (display) display.remove();
}

function showCoordinateSuccess(clientX, clientY, pageX, pageY) {
    const success = document.createElement('div');
    success.className = 'echoclicker-success';
    success.innerHTML = `
        <div style="
            position: fixed;
            left: ${clientX}px;
            top: ${clientY}px;
            transform: translate(-50%, -50%);
            background: #FF6B6B;
            color: white;
            padding: 12px 18px;
            border-radius: 25px;
            font-size: 14px;
            font-weight: bold;
            z-index: 2147483647;
            box-shadow: 0 4px 15px rgba(255, 107, 107, 0.4);
            pointer-events: none;
            animation: echoclicker-bounce 0.6s ease-out;
            text-align: center;
        ">
            📍 좌표 선택됨!<br>
            <small style="font-size: 11px; opacity: 0.9;">(${pageX}, ${pageY})</small>
        </div>
    `;
    
    document.body.appendChild(success);
    setTimeout(() => success.remove(), 2000);
}


// --- 오토클리커 로직 ---
function startAutoClicker(options) {
    if (autoClickerInterval) stopAutoClicker();

    const { target, radius, minInterval, maxInterval, duration } = options;
    autoClickerEndTime = Date.now() + duration;

    console.log('[CONTENT] 오토클리커 시작:', { target, radius, duration });

    const clickFunction = () => {
        if (Date.now() >= autoClickerEndTime) {
            console.log('[CONTENT] 오토클리커 시간 종료');
            stopAutoClicker();
            return;
        }

        const angle = Math.random() * 2 * Math.PI;
        const r = Math.random() * radius;
        const targetX = target.centerX + r * Math.cos(angle);
        const targetY = target.centerY + r * Math.sin(angle);
        
        console.log('[CONTENT] 클릭 실행:', { targetX, targetY });
        
        // 좌표로 직접 클릭 이벤트 생성
        const clickEvent = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: targetX - window.scrollX,
            clientY: targetY - window.scrollY
        });
        
        // 해당 좌표의 요소를 찾아서 클릭 (없으면 document에 클릭)
        const element = document.elementFromPoint(targetX - window.scrollX, targetY - window.scrollY) || document;
        element.dispatchEvent(clickEvent);

        const nextInterval = Math.random() * (maxInterval - minInterval) + minInterval;
        autoClickerInterval = setTimeout(clickFunction, nextInterval);
    };

    // 상태 업데이트
    chrome.runtime.sendMessage({ action: 'autoClickerStateChanged', isAutoClicking: true });
    
    clickFunction(); // 첫 클릭은 즉시 시작
}

function stopAutoClicker() {
    if (autoClickerInterval) {
        console.log('[CONTENT] 오토클리커 중지');
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