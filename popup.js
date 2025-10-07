// UI 요소 가져오기
const recordBtn = document.getElementById('recordBtn');
const stopBtn = document.getElementById('stopBtn');
const runBtn = document.getElementById('runBtn');
const scriptSelector = document.getElementById('scriptSelector');
const scriptNameInput = document.getElementById('scriptName');
const saveBtn = document.getElementById('saveBtn');
const deleteBtn = document.getElementById('deleteBtn');
const editor = document.getElementById('editor');
const statusDiv = document.getElementById('status');

let isRecording = false;

// 확장 프로그램이 열릴 때 저장된 스크립트 목록 불러오기
document.addEventListener('DOMContentLoaded', loadScripts);

// 이벤트 리스너 등록
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

// 녹화 시작
async function startRecording() {
  const tab = await getCurrentTab();
  if (!tab.url.startsWith('http')) {
    updateStatus('Cannot record on this page.', 'error');
    return;
  }
  isRecording = true;
  updateUI();
  editor.value = ''; // 에디터 초기화
  // content.js에 녹화 시작 메시지 전송
  chrome.tabs.sendMessage(tab.id, { action: 'startRecording' });
  updateStatus('Recording started...', 'active');
}

// 녹화 중지
async function stopRecording() {
  const tab = await getCurrentTab();
  isRecording = false;
  updateUI();
  // content.js에 녹화 중지 메시지를 보내고, 녹화된 데이터를 콜백으로 받음
  chrome.tabs.sendMessage(tab.id, { action: 'stopRecording' }, (response) => {
    if (response && response.actions) {
      // 받은 action 객체 배열을 보기 좋은 코드로 변환
      editor.value = formatActionsToCode(response.actions);
      updateStatus('Recording stopped. Actions logged.');
    } else {
      updateStatus('No actions were recorded.', 'error');
    }
  });
}

// 스크립트 실행
async function runScript() {
  const tab = await getCurrentTab();
  const scriptContent = editor.value;
  if (!scriptContent) {
    updateStatus('No script to run.', 'error');
    return;
  }
  try {
    // 코드를 action 객체 배열로 다시 파싱
    const actions = parseCodeToActions(scriptContent);
    updateStatus('Running script...', 'active');
    // content.js에 실행할 action 배열을 전송
    chrome.tabs.sendMessage(tab.id, { action: 'executeScript', actions }, (response) => {
      if (response.status === 'success') {
        updateStatus(`Script finished successfully in ${response.duration}ms.`);
      } else {
        updateStatus(`Script failed: ${response.message}`, 'error');
      }
    });
  } catch (e) {
    updateStatus(`Invalid script format: ${e.message}`, 'error');
  }
}

// --- 스크립트 관리 함수들 ---

async function saveScript() {
  const name = scriptNameInput.value;
  const code = editor.value;
  if (!name || !code) {
    updateStatus('Script name and content cannot be empty.', 'error');
    return;
  }
  await chrome.storage.local.set({ [name]: code });
  updateStatus(`Script "${name}" saved.`);
  loadScripts(); // 목록 새로고침
}

async function loadScripts() {
  const items = await chrome.storage.local.get(null);
  scriptSelector.innerHTML = '<option value="">Select a script</option>';
  for (const name in items) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    scriptSelector.appendChild(option);
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
    updateStatus('Select a script to delete.', 'error');
    return;
  }
  await chrome.storage.local.remove(name);
  updateStatus(`Script "${name}" deleted.`);
  editor.value = '';
  scriptNameInput.value = '';
  loadScripts(); // 목록 새로고침
}


// --- 유틸리티 함수들 ---

function updateUI() {
  recordBtn.disabled = isRecording;
  stopBtn.disabled = !isRecording;
  runBtn.disabled = isRecording;
}

function updateStatus(message, type = 'info') {
  statusDiv.textContent = message;
  statusDiv.style.color = type === 'error' ? 'red' : (type === 'active' ? 'blue' : 'black');
}

// 녹화된 action 객체 배열을 사용자가 읽기 쉬운 코드로 변환
function formatActionsToCode(actions) {
  return actions.map(action => {
    switch(action.type) {
      case 'click':
        return `click("${action.selector}");`;
      case 'type':
        // 따옴표 처리
        const escapedValue = action.value.replace(/"/g, '\\"');
        return `type("${action.selector}", "${escapedValue}");`;
      case 'wait':
        return `wait(${action.ms});`;
      default:
        return `// Unknown action: ${action.type}`;
    }
  }).join('\n');
}

// 사용자가 작성한 코드를 다시 action 객체 배열로 파싱
// (실제 프로덕션에서는 정교한 파서가 필요하지만, 여기서는 간단한 정규식으로 구현)
function parseCodeToActions(code) {
    const actions = [];
    const lines = code.split('\n').filter(line => line.trim() !== '');
    const commandRegex = /(\w+)\((.*)\);/;

    for (const line of lines) {
        const match = line.match(commandRegex);
        if (!match) continue;

        const [, command, argsStr] = match;
        const args = argsStr.split(/, ?(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(arg => arg.trim().replace(/^"|"$/g, ''));
        
        if (command === 'click' && args.length === 1) {
            actions.push({ type: 'click', selector: args[0] });
        } else if (command === 'type' && args.length === 2) {
            actions.push({ type: 'type', selector: args[0], value: args[1] });
        } else if (command === 'wait' && args.length === 1) {
            actions.push({ type: 'wait', ms: parseInt(args[0], 10) });
        }
    }
    return actions;
}

// 메시지 리스너 (content.js 로부터의 메시지 수신 - 예: 녹화 중 상태 업데이트)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updatePopup') {
    // 녹화된 액션을 실시간으로 에디터에 추가
    const newCodeLine = formatActionsToCode([request.newAction]);
    editor.value += newCodeLine + '\n';
  }
});