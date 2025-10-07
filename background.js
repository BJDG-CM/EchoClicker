// 예시: 30분마다 'my-periodic-task'라는 이름의 스크립트를 실행하는 알람 설정
// 실제 구현에서는 사용자가 popup UI에서 직접 설정하도록 만들어야 합니다.

// 확장 프로그램이 설치될 때 실행
chrome.runtime.onInstalled.addListener(() => {
  console.log('Web Automation Scripter installed.');
  // 예시 알람 생성
  // chrome.alarms.create('runMyScript', {
  //   delayInMinutes: 1,
  //   periodInMinutes: 30
  // });
});

// 알람이 울렸을 때 실행될 리스너
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'runMyScript') {
    console.log('Periodic task triggered!');
    
    // 저장된 'my-periodic-task' 스크립트를 가져옴
    const result = await chrome.storage.local.get('my-periodic-task');
    const scriptCode = result['my-periodic-task'];

    if (scriptCode) {
      // 새 탭을 열고 스크립트 실행 (예시)
      const tab = await chrome.tabs.create({ url: 'https://example.com', active: false });

      // 탭 로딩이 완료될 때까지 기다림
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (info.status === 'complete' && tabId === tab.id) {
          chrome.tabs.onUpdated.removeListener(listener);
          
          // content.js 주입 및 스크립트 실행 메시지 전송
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          }, () => {
            const actions = parseCodeToActions(scriptCode); // popup.js의 함수 재사용 필요
            chrome.tabs.sendMessage(tab.id, { action: 'executeScript', actions }, (response) => {
              if (response && response.status === 'success') {
                chrome.notifications.create({
                  type: 'basic',
                  iconUrl: 'icons/icon128.png',
                  title: 'Task Complete',
                  message: 'Periodic task "my-periodic-task" ran successfully.'
                });
                chrome.tabs.remove(tab.id); // 작업 후 탭 닫기
              }
            });
          });
        }
      });
    }
  }
});

// background.js에서는 DOM에 접근할 수 없으므로, 파싱 함수를 background에서도 사용할 수 있게
// 별도 유틸리티 파일로 분리하는 것이 좋습니다. 여기서는 개념 설명을 위해 생략합니다.
function parseCodeToActions(code) {
  // ... (popup.js의 parseCodeToActions 함수와 동일) ...
  return []; // 실제 구현 필요
}