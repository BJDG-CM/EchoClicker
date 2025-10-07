// UI 요소 가져오기
const statusDiv = document.getElementById('status');
// 매크로 UI
const recordBtn = document.getElementById('recordBtn');
const stopBtn = document.getElementById('stopBtn');
const runBtn = document.getElementById('runBtn');
const scriptSelector = document.getElementById('scriptSelector');
const scriptNameInput = document.getElementById('scriptName');
const saveBtn = document.getElementById('saveBtn');
const deleteBtn = document.getElementById('deleteBtn');
const editor = document.getElementById('editor');
// 오토클리커 UI
const selectTargetBtn = document.getElementById('selectTargetBtn');
const startAutoClickerBtn = document.getElementById('startAutoClickerBtn');
const stopAutoClickerBtn = document.getElementById('stopAutoClickerBtn');
const targetSelectorDisplay = document.getElementById('targetSelectorDisplay');
const cpmInput = document.getElementById('cpmInput');
const radiusInput = document.getElementById('radiusInput');
const durationInput = document.getElementById('durationInput');

// 오토클리커 타겟 정보 저장 변수
let autoClickerTarget = null;

// --- 초기화 및 상태 동기화 ---
document.addEventListener('DOMContentLoaded', async () => {
  await loadScripts();
  // 백그라운드로부터 현재 상태 받아와서 UI 전체 업데이트
  const state = await chrome.runtime.sendMessage({ action: 'getGlobalState' });
  updateMacroUI(state.isRecording);
  updateAutoClickerUI(state.isAutoClicking, state.autoClickerTarget);
  if(state.autoClickerTarget) {
      autoClickerTarget = state.autoClickerTarget;
  }
});

// --- 이벤트 리스너 ---
// 매크로
recordBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', stopRecording);
runBtn.addEventListener('click', runScript);
saveBtn.addEventListener('click', saveScript);
deleteBtn.addEventListener('click', deleteScript);
scriptSelector.addEventListener('change', onScriptSelect);
// 오토클리커
selectTargetBtn.addEventListener('click', selectAutoClickerTarget);
startAutoClickerBtn.addEventListener('click', startAutoClicker);
stopAutoClickerBtn.addEventListener('click', stopAutoClicker);

// --- 오토클리커 함수 ---
async function selectAutoClickerTarget() {
  const tab = await getCurrentTab();
  if (!tab) return;
  updateStatus('타겟 선택 모드: 페이지에서 원하는 요소를 클릭하세요.', 'active');
  // content.js에 타겟 선택 모드 시작 요청
  const response = await chrome.runtime.sendMessage({ action: 'enterSelectionMode', tabId: tab.id });
  if (response.status !== 'success') {
    updateStatus(`타겟 선택 모드 시작 실패: ${response.message}`, 'error');
  }
  // 선택이 완료되면 background.js로부터 메시지를 받아 처리 (하단 onMessage 리스너)
  window.close(); // 팝업을 닫아 페이지 선택이 용이하게 함
}

async function startAutoClicker() {
  const tab = await getCurrentTab();
  if (!tab || !autoClickerTarget) {
    updateStatus('타겟이 선택되지 않았습니다.', 'error');
    return;
  }
  
  const cpm = parseInt(cpmInput.value, 10);
  const clickInterval = 60 * 1000 / cpm; // CPM을 ms 간격으로 변환

  const options = {
    target: autoClickerTarget,
    radius: parseInt(radiusInput.value, 10),
    minInterval: clickInterval * 0.8, // 간격에 20% 랜덤 편차 부여
    maxInterval: clickInterval * 1.2,
    duration: parseInt(durationInput.value, 10) * 1000, // 초를 ms로 변환
  };

  const response = await chrome.runtime.sendMessage({ action: 'startAutoClicker', tabId: tab.id, options });
  if (response.status === 'success') {
    updateStatus('오토클리커 시작됨.', 'active');
    updateAutoClickerUI(true, autoClickerTarget);
  } else {
    updateStatus(`오토클리커 시작 실패: ${response.message}`, 'error');
  }
}

async function stopAutoClicker() {
  const response = await chrome.runtime.sendMessage({ action: 'stopAutoClicker' });
  if (response.status === 'success') {
    updateStatus('오토클리커 중지됨.');
    updateAutoClickerUI(false, autoClickerTarget);
  } else {
    updateStatus(`오토클리커 중지 실패: ${response.message}`, 'error');
  }
}


// --- 매크로 함수 ---
async function startRecording() {
  const tab = await getCurrentTab();
  if (!tab) return;
  editor.value = '';
  const response = await chrome.runtime.sendMessage({ action: 'startRecording', tabId: tab.id });
  if (response.status === 'success') {
    updateStatus('녹화가 시작되었습니다.', 'active');
    updateMacroUI(true);
  }
}

async function stopRecording() {
  const response = await chrome.runtime.sendMessage({ action: 'stopRecording' });
  if (response.status === 'success') {
    editor.value = formatActionsToCode(response.actions);
    updateStatus('녹화가 중지되었습니다.');
    updateMacroUI(false);
  }
}

async function runScript() {
  const tab = await getCurrentTab();
  if (!tab) return;
  const scriptContent = editor.value;
  if (!scriptContent) {
    updateStatus('실행할 스크립트가 없습니다.', 'error');
    return;
  }
  try {
    const actions = parseCodeToActions(scriptContent);
    updateStatus('스크립트 실행 중...', 'active');
    const response = await chrome.runtime.sendMessage({ action: 'executeScript', tabId: tab.id, actions });
    if (response.status === 'success') {
      updateStatus(`스크립트가 성공적으로 완료되었습니다.`);
    } else {
      updateStatus(`스크립트 실행 실패: ${response.message}`, 'error');
    }
  } catch (e) {
    updateStatus(`잘못된 스크립트 형식: ${e.message}`, 'error');
  }
}


// --- 스크립트 저장/로드 (이전과 동일) ---
async function saveScript() {
  const name = scriptNameInput.value;
  const code = editor.value;
  if (!name || !code) {
    updateStatus('스크립트 이름과 내용은 비워둘 수 없습니다.', 'error');
    return;
  }
  await chrome.storage.local.set({ [name]: code });
  updateStatus(`스크립트 "${name}"이(가) 저장되었습니다.`);
  await loadScripts();
}

async function loadScripts() {
  const items = await chrome.storage.local.get(null);
  scriptSelector.innerHTML = '<option value="">스크립트 선택</option>';
  for (const name in items) {
    if (typeof items[name] === 'string') {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      scriptSelector.appendChild(option);
    }
  }
}

function onScriptSelect() {
  const name = scriptSelector.value;
  if (!name) {
    editor.value = '';
    scriptNameInput.value = '';
    return;
  }
  chrome.storage.local.get(name, (result) => {
    editor.value = result[name] || '';
    scriptNameInput.value = name;
  });
}

async function deleteScript() {
  const name = scriptSelector.value;
  if (!name) return;
  await chrome.storage.local.remove(name);
  updateStatus(`스크립트 "${name}"이(가) 삭제되었습니다.`);
  editor.value = '';
  scriptNameInput.value = '';
  await loadScripts();
}


// --- 유틸리티 함수 ---
async function getCurrentTab() {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.startsWith('http')) {
    updateStatus('유효한 페이지에서 실행해주세요.', 'error');
    return null;
  }
  return tab;
}

function updateStatus(message, type = 'info') {
  statusDiv.textContent = message;
  statusDiv.className = `status-${type}`;
}

function updateMacroUI(isRecording) {
  recordBtn.disabled = isRecording;
  stopBtn.disabled = !isRecording;
  runBtn.disabled = isRecording;
}

function updateAutoClickerUI(isAutoClicking, target) {
    if (target) {
        autoClickerTarget = target;
        targetSelectorDisplay.textContent = target.selector;
        targetSelectorDisplay.title = target.selector;
    }
    startAutoClickerBtn.disabled = isAutoClicking || !autoClickerTarget;
    stopAutoClickerBtn.disabled = !isAutoClicking;
    selectTargetBtn.disabled = isAutoClicking;
}

// --- 메시지 리스너 ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updatePopupEditor' && request.newAction) {
    const newCodeLine = formatActionsToCode([request.newAction]);
    editor.value += newCodeLine + '\n';
    editor.scrollTop = editor.scrollHeight;
  } else if (request.action === 'updateGlobalState') {
    updateMacroUI(request.state.isRecording);
    updateAutoClickerUI(request.state.isAutoClicking, request.state.autoClickerTarget);
  } else if (request.action === 'autoClickerTargetSelected') {
    // content.js에서 타겟 선택이 완료되면 background.js를 통해 이 메시지를 받음
    updateAutoClickerUI(false, request.target);
    updateStatus('타겟이 선택되었습니다. 이제 시작 버튼을 누르세요.');
  }
});


// --- 파서 및 포맷터 (이전과 동일하게 견고한 버전) ---
function formatActionsToCode(actions) {
  return actions.map(action => {
    switch (action.type) {
      case 'click':
        return `click("${action.selector}");`;
      case 'type':
        const escapedValue = action.value.replace(/"/g, '\\"');
        return `type("${action.selector}", "${escapedValue}");`;
      case 'wait':
        return `wait(${action.ms});`;
      default:
        return `// 알 수 없는 작업: ${action.type}`;
    }
  }).join('\n');
}

function parseCodeToActions(code) {
    const actions = [];
    const lines = code.split('\n').filter(line => line.trim() !== '' && !line.startsWith('//'));
    const commandRegex = /(\w+)\((.*)\);/;

    for (const line of lines) {
        const trimmedLine = line.trim();
        const match = trimmedLine.match(commandRegex);
        if (!match) {
            console.warn(`[Parse Error] Skipping malformed line: "${trimmedLine}"`);
            continue;
        }
        const [, command, argsStr] = match;
        let args = [];
        try {
            args = JSON.parse(`[${argsStr}]`);
        } catch (e) {
            console.warn(`[Parse Error] Invalid arguments format: "${argsStr}"`);
            continue;
        }
        
        if (command === 'click' && args.length === 1 && typeof args[0] === 'string') {
            actions.push({ type: 'click', selector: args[0] });
        } else if (command === 'type' && args.length === 2 && typeof args[0] === 'string' && typeof args[1] === 'string') {
            actions.push({ type: 'type', selector: args[0], value: args[1] });
        } else if (command === 'wait' && args.length === 1 && typeof args[0] === 'number') {
            actions.push({ type: 'wait', ms: args[0] });
        } else {
            console.warn(`[Parse Error] Unknown command or invalid arguments: "${trimmedLine}"`);
        }
    }
    return actions;
}