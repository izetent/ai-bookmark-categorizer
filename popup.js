// API 密钥相关功能
document.getElementById('saveApiKey').addEventListener('click', async () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  const apiStatus = document.getElementById('apiStatus');
  
  if (!apiKey) {
    apiStatus.textContent = '请输入API密钥';
    apiStatus.className = 'status error';
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'setApiKey',
      apiKey: apiKey
    });

    if (response.success) {
      apiStatus.textContent = '密钥保存成功';
      apiStatus.className = 'status success';
      document.getElementById('apiKey').value = '';
    } else {
      throw new Error(response.error || '保存失败');
    }
  } catch (error) {
    apiStatus.textContent = error.message;
    apiStatus.className = 'status error';
  }
});

// 添加密钥显示/隐藏功能
document.getElementById('toggleApiKey').addEventListener('click', async () => {
  const apiKeyInput = document.getElementById('apiKey');
  const toggleBtn = document.getElementById('toggleApiKey');
  
  if (apiKeyInput.type === 'password') {
    apiKeyInput.type = 'text';
    toggleBtn.textContent = '🔒';
    toggleBtn.title = '隐藏密钥';
  } else {
    apiKeyInput.type = 'password';
    toggleBtn.textContent = '👁️';
    toggleBtn.title = '显示密钥';
  }
});

// 添加复制功能
document.getElementById('copyApiKey').addEventListener('click', async () => {
  const apiKeyInput = document.getElementById('apiKey');
  const currentKey = apiKeyInput.value;
  
  if (!currentKey) {
    // 如果输入框为空，尝试从存储中获取密钥
    const { apiKey } = await chrome.storage.sync.get('apiKey');
    if (apiKey) {
      await copyToClipboard(apiKey);
      showCopyTooltip('密钥已复制');
    } else {
      showCopyTooltip('没有保存的密钥');
    }
  } else {
    await copyToClipboard(currentKey);
    showCopyTooltip('密钥已复制');
  }
});

// 复制到剪贴板
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    // 如果clipboard API不可用，使用传统方法
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

// 显示复制成功提示
function showCopyTooltip(message) {
  const tooltip = document.createElement('div');
  tooltip.className = 'copy-tooltip';
  tooltip.textContent = message;
  
  // 定位在复制按钮下方
  const copyBtn = document.getElementById('copyApiKey');
  const rect = copyBtn.getBoundingClientRect();
  tooltip.style.left = `${rect.left}px`;
  tooltip.style.top = `${rect.bottom + 5}px`;
  
  document.body.appendChild(tooltip);
  
  // 1.5秒后移除提示
  setTimeout(() => {
    document.body.removeChild(tooltip);
  }, 1500);
}

// 检查是否已设置API密钥
async function checkApiKey() {
  const { apiKey } = await chrome.storage.sync.get('apiKey');
  const apiStatus = document.getElementById('apiStatus');
  const apiKeyInput = document.getElementById('apiKey');
  
  if (apiKey) {
    apiStatus.textContent = '已设置API密钥';
    apiStatus.className = 'status success';
    apiKeyInput.value = apiKey;
  }
}

// 添加状态检查和更新
async function checkClassificationState() {
  const result = await chrome.runtime.sendMessage({
    action: 'getClassificationState'
  });

  if (result.isRunning) {
    // 如果分类正在进行，显示进度
    const progress = document.getElementById('progress');
    const progressFill = document.querySelector('.progress-fill');
    const percentage = document.getElementById('percentage');
    const status = document.getElementById('status');
    const processedCount = document.getElementById('processedCount');
    const totalCount = document.getElementById('totalCount');

    progress.classList.remove('hidden');
    progressFill.style.width = `${result.progress}%`;
    percentage.textContent = `${Math.round(result.progress)}%`;
    status.textContent = result.status;
    processedCount.textContent = result.processed;
    totalCount.textContent = result.total;
  }
}

// 修改页面加载时的检查
document.addEventListener('DOMContentLoaded', async () => {
  await checkApiKey();
  await checkClassificationState();
});

// 修改开始分类按钮处理
document.getElementById('startBtn').addEventListener('click', async () => {
  const progress = document.getElementById('progress');
  const status = document.getElementById('status');
  const progressFill = document.querySelector('.progress-fill');
  
  try {
    // 重置进度显示
    progress.classList.remove('hidden');
    progressFill.style.width = '0%';
    document.getElementById('percentage').textContent = '0%';
    status.textContent = '准备中...';
    
    // 获取所有书签
    const bookmarks = await chrome.bookmarks.getTree();
    const flatBookmarks = flattenBookmarks(bookmarks);
    
    // 发送到后台进行 AI 分类
    const result = await chrome.runtime.sendMessage({
      action: 'classifyBookmarks',
      bookmarks: flatBookmarks
    });

    if (result.error) {
      throw new Error(result.error);
    }
    
    // 显示结果
    if (!result.isRunning) {
      displayResults(result);
    }
  } catch (error) {
    status.textContent = '分类过程出错: ' + error.message;
  }
});

function flattenBookmarks(nodes) {
  let bookmarks = [];
  for (const node of nodes) {
    if (node.children) {
      bookmarks = bookmarks.concat(flattenBookmarks(node.children));
    } else if (node.url) {
      bookmarks.push({
        id: node.id,
        title: node.title,
        url: node.url
      });
    }
  }
  return bookmarks;
}

function displayResults(categories) {
  const results = document.getElementById('results');
  const categoryList = document.getElementById('categoryList');
  results.classList.remove('hidden');
  categoryList.innerHTML = '';
  
  for (const [mainCategory, data] of Object.entries(categories)) {
    const li = document.createElement('li');
    const subCategories = data.subCategories;
    
    let subCategoryHtml = '';
    for (const [subName, subFolder] of Object.entries(subCategories)) {
      subCategoryHtml += `
        <li class="sub-category">
          <h5>${subName}</h5>
        </li>
      `;
    }
    
    li.innerHTML = `
      <h4>${mainCategory}</h4>
      <ul class="sub-categories">
        ${subCategoryHtml}
      </ul>
    `;
    categoryList.appendChild(li);
  }
}

// 添加打散文件夹按钮的处理
document.getElementById('flattenBtn').addEventListener('click', async () => {
  const status = document.getElementById('status');
  const progress = document.getElementById('progress');
  progress.classList.remove('hidden');
  status.textContent = '正在打散文件夹...';
  
  try {
    const result = await chrome.runtime.sendMessage({
      action: 'flattenFolders'
    });
    
    if (result.success) {
      status.textContent = result.message;
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    status.textContent = '操作失败: ' + error.message;
  }
});

// 修改清理重复书签按钮的处理
document.getElementById('cleanDuplicatesBtn').addEventListener('click', async () => {
  const progress = document.getElementById('progress');
  const status = document.getElementById('status');
  const progressFill = document.querySelector('.progress-fill');
  
  try {
    // 重置进度显示
    progress.classList.remove('hidden');
    progressFill.style.width = '0%';
    document.getElementById('percentage').textContent = '0%';
    status.textContent = '正在查找重复书签...';
    
    const result = await chrome.runtime.sendMessage({
      action: 'cleanDuplicates'
    });
    
    if (result && result.success) {
      status.textContent = result.message;
      progressFill.style.width = '100%';
      document.getElementById('percentage').textContent = '100%';
    } else {
      throw new Error(result?.error || '清理失败');
    }
  } catch (error) {
    console.error('清理重复书签时出错:', error);
    status.textContent = '清理失败: ' + (error.message || '未知错误');
    progressFill.style.width = '0%';
    document.getElementById('percentage').textContent = '0%';
  }
});

// 页面加载时检查API密钥
document.addEventListener('DOMContentLoaded', checkApiKey);

// 添加教程控制
document.getElementById('showTutorial').addEventListener('click', () => {
  document.getElementById('tutorial').classList.remove('hidden');
});

document.getElementById('closeTutorial').addEventListener('click', () => {
  document.getElementById('tutorial').classList.add('hidden');
});

// 在新标签页打开链接
document.addEventListener('click', (e) => {
  if (e.target.tagName === 'A' && e.target.href) {
    e.preventDefault();
    chrome.tabs.create({ url: e.target.href });
  }
}); 