const recordBtn = document.getElementById('recordBtn');
const stopBtn = document.getElementById('stopBtn');
const runBtn = document.getElementById('runBtn');
const scriptSelector = document.getElementById('scriptSelector');
const scriptNameInput = document.getElementById('scriptName');
const saveBtn = document.getElementById('saveBtn');
const deleteBtn = document.getElementById('deleteBtn');
const editor = document.getElementById('editor');
const statusDiv = document.getElementById('status');

// 팝업이 열릴 때마다 초기 상태를 백그라운드로부터 가져옴
document.addEventListener('DOMContentLoaded', async () => {
  await loadScripts();
  // 백그라운드로부터 현재 녹화 상태를 받아 UI 업데이트
  const isRecording = await chrome.runtime.sendMessage({ action: 'getRecordingState' });
  updateUI(isRecording);
});

// 이벤트 리스너 등록 (동일)
recordBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', stopRecording);
runBtn.addEventListener('click', runScript);
saveBtn.addEventListener('click', saveScript);
deleteBtn.addEventListener('click', deleteScript);
scriptSelector.addEventListener('change', onScriptSelect);

// 현재 탭 정보를 가져오는 헬퍼 함수
async function getCurrentTab() {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// 녹화 시작 요청 (popup.js는 직접 녹화하지 않고 background.js에 요청)
async function startRecording() {
  const tab = await getCurrentTab();
  if (!tab || !tab.url || !tab.url.startsWith('http')) {
    updateStatus('이 페이지에서는 녹화를 시작할 수 없습니다.', 'error');
    return;
  }
  editor.value = ''; // 에디터 초기화
  updateStatus('녹화 시작 중...', 'active');
  const response = await chrome.runtime.sendMessage({ action: 'startRecording', tabId: tab.id });
  if (response.status === 'success') {
    updateStatus('녹화가 시작되었습니다.', 'active');
    updateUI(true); // 녹화 중 상태로 UI 업데이트
  } else {
    updateStatus(`녹화 시작 실패: ${response.message}`, 'error');
  }
}

// 녹화 중지 요청
async function stopRecording() {
  updateStatus('녹화 중지 중...', 'info');
  const response = await chrome.runtime.sendMessage({ action: 'stopRecording' });
  if (response.status === 'success') {
    editor.value = formatActionsToCode(response.actions);
    updateStatus('녹화가 중지되었습니다. 작업이 기록되었습니다.');
    updateUI(false); // 녹화 중지 상태로 UI 업데이트
  } else {
    updateStatus(`녹화 중지 실패: ${response.message}`, 'error');
  }
}

// 스크립트 실행 요청
async function runScript() {
  const tab = await getCurrentTab();
  if (!tab || !tab.url || !tab.url.startsWith('http')) {
    updateStatus('이 페이지에서는 스크립트를 실행할 수 없습니다.', 'error');
    return;
  }
  const scriptContent = editor.value;
  if (!scriptContent) {
    updateStatus('실행할 스크립트가 없습니다.', 'error');
    return;
  }
  try {
    const actions = parseCodeToActions(scriptContent);
    updateStatus('스크립트 실행 중...', 'active');
    // background.js를 통해 content.js로 스크립트 실행 명령 전달
    const response = await chrome.runtime.sendMessage({ action: 'executeScript', tabId: tab.id, actions });
    if (response.status === 'success') {
      updateStatus(`스크립트가 성공적으로 완료되었습니다 (${response.duration}ms).`);
    } else {
      updateStatus(`스크립트 실행 실패: ${response.message}`, 'error');
    }
  } catch (e) {
    updateStatus(`잘못된 스크립트 형식: ${e.message}`, 'error');
  }
}

// 스크립트 관리 함수들 (동일)
async function saveScript() {
  const name = scriptNameInput.value;
  const code = editor.value;
  if (!name || !code) {
    updateStatus('스크립트 이름과 내용은 비워둘 수 없습니다.', 'error');
    return;
  }
  await chrome.storage.local.set({ [name]: code });
  updateStatus(`스크립트 "${name}"이(가) 저장되었습니다.`);
  await loadScripts(); // 목록 새로고침
}

async function loadScripts() {
  const items = await chrome.storage.local.get(null);
  scriptSelector.innerHTML = '<option value="">스크립트 선택</option>';
  for (const name in items) {
    if (typeof items[name] === 'string') { // 스크립트만 로드
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
  if (!name) {
    updateStatus('삭제할 스크립트를 선택하세요.', 'error');
    return;
  }
  await chrome.storage.local.remove(name);
  updateStatus(`스크립트 "${name}"이(가) 삭제되었습니다.`);
  editor.value = '';
  scriptNameInput.value = '';
  await loadScripts(); // 목록 새로고침
}

// --- 유틸리티 함수들 ---

// UI 상태 업데이트 함수
function updateUI(isRecordingState) {
  recordBtn.disabled = isRecordingState;
  stopBtn.disabled = !isRecordingState;
  runBtn.disabled = isRecordingState;
}

// 상태 메시지 업데이트 함수 (스타일 클래스 추가)
function updateStatus(message, type = 'info') {
  statusDiv.textContent = message;
  statusDiv.className = `status-${type}`; // CSS 클래스 변경
}

// (formatActionsToCode, parseCodeToActions는 동일하게 유지)
// 녹화된 action 객체 배열을 사용자가 읽기 쉬운 코드로 변환
function formatActionsToCode(actions) {
  return actions.map(action => {
    switch(action.type) {
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

// 사용자가 작성한 코드를 다시 action 객체 배열로 파싱
function parseCodeToActions(code) {
    const actions = [];
    const lines = code.split('\n').filter(line => line.trim() !== '' && !line.startsWith('//'));
    const commandRegex = /(\w+)\((.*)\);/;

    for (const line of lines) {
        const match = line.match(commandRegex);
        if (!match) {
            console.warn(`Skipping malformed line: ${line}`);
            continue;
        }

        const [, command, argsStr] = match;
        // 콤마로 구분하되, 따옴표 안의 콤마는 무시
        const args = argsStr.split(/, ?(?=(?:[^"]*"[^"]*")*[^"]*$)/)
                            .map(arg => arg.trim().replace(/^"|"$/g, ''));
        
        if (command === 'click' && args.length === 1) {
            actions.push({ type: 'click', selector: args[0] });
        } else if (command === 'type' && args.length === 2) {
            actions.push({ type: 'type', selector: args[0], value: args[1] });
        } else if (command === 'wait' && args.length === 1) {
            const ms = parseInt(args[0], 10);
            if (isNaN(ms) || ms < 0) throw new Error(`Invalid wait time: ${args[0]}`);
            actions.push({ type: 'wait', ms: ms });
        } else {
            console.warn(`Unknown command or invalid arguments: ${command}(${argsStr})`);
        }
    }
    return actions;
}

// background.js로부터 오는 메시지 리스너 (실시간 녹화 업데이트 등)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updatePopupEditor' && request.newAction) {
    const newCodeLine = formatActionsToCode([request.newAction]);
    editor.value += newCodeLine + '\n';
    editor.scrollTop = editor.scrollHeight; // 스크롤을 최하단으로
  } else if (request.action === 'updatePopupUI') {
      updateUI(request.isRecording);
  }
});